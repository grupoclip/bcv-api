package bcv

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	defaultTimeout  = 10 * time.Second
	defaultCacheTTL = 5 * time.Minute
	maxBodyBytes    = 32 << 20
)

// Client reads the free, read-only BCV Today API (https://bcv.today/api/).
//
// A Client is safe for concurrent use by multiple goroutines. Responses are kept
// in an in-memory cache (5 minutes by default) and concurrent requests for the
// same path share one HTTP request.
type Client struct {
	baseURL    string
	httpClient *http.Client
	timeout    time.Duration
	cacheTTL   time.Duration
	userAgent  string
	now        func() time.Time
	err        error // invalid option, returned by every method

	cache    *ttlCache
	mu       sync.Mutex
	inflight map[string]*call
}

// Option configures a [Client].
type Option func(*Client)

// WithBaseURL sets the API origin (default "https://bcv.today"). It must start with
// https:// or http://; otherwise every method returns an ErrInvalidArgument error.
func WithBaseURL(baseURL string) Option { return func(c *Client) { c.baseURL = baseURL } }

// WithHTTPClient sets the HTTP client used for requests (default: a client using
// http.DefaultTransport). Use it for proxies, custom transports or tests.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) {
		if hc != nil {
			c.httpClient = hc
		}
	}
}

// WithTimeout sets the per-request timeout (default 10s; 0 disables it). The
// context passed to each method can impose a shorter deadline.
func WithTimeout(d time.Duration) Option { return func(c *Client) { c.timeout = d } }

// WithCacheTTL sets how long responses stay in the in-memory cache (default 5m; 0
// disables caching). The data changes at most a few times per business day.
func WithCacheTTL(d time.Duration) Option { return func(c *Client) { c.cacheTTL = d } }

// WithUserAgent sets the User-Agent header (default [DefaultUserAgent]).
func WithUserAgent(ua string) Option {
	return func(c *Client) {
		if ua != "" {
			c.userAgent = ua
		}
	}
}

// WithClock sets the clock used for "today in Caracas", data age and cache expiry
// (default time.Now). Meant for tests.
func WithClock(now func() time.Time) Option {
	return func(c *Client) {
		if now != nil {
			c.now = now
		}
	}
}

// New returns a client configured by opts.
//
// Invalid options (a base URL that is not http(s), a negative timeout or cache
// TTL) do not panic: every method of the returned client then fails with an
// ErrInvalidArgument error explaining the problem.
func New(opts ...Option) *Client {
	c := &Client{
		baseURL:    DefaultBaseURL,
		httpClient: &http.Client{},
		timeout:    defaultTimeout,
		cacheTTL:   defaultCacheTTL,
		userAgent:  DefaultUserAgent,
		now:        time.Now,
		inflight:   map[string]*call{},
	}
	for _, opt := range opts {
		if opt != nil {
			opt(c)
		}
	}
	switch {
	case !strings.HasPrefix(c.baseURL, "https://") && !strings.HasPrefix(c.baseURL, "http://"):
		c.err = newError(ErrInvalidArgument, "Invalid base URL %s: it must start with https:// or http://.", repr(c.baseURL))
	case c.timeout < 0:
		c.err = newError(ErrInvalidArgument, "Invalid timeout %s: use a duration >= 0.", c.timeout)
	case c.cacheTTL < 0:
		c.err = newError(ErrInvalidArgument, "Invalid cache TTL %s: use a duration >= 0.", c.cacheTTL)
	}
	c.baseURL = strings.TrimRight(c.baseURL, "/")
	c.cache = newTTLCache(c.cacheTTL)
	return c
}

// BaseURL returns the API origin without trailing slashes.
func (c *Client) BaseURL() string { return c.baseURL }

// ClearCache forgets every cached response.
func (c *Client) ClearCache() { c.cache.clear() }

// ------------------------------------------------------------------ cache

type cacheEntry struct {
	expires time.Time
	value   any
}

// ttlCache is a tiny in-memory cache with a per-entry deadline; cleared when it grows past 64 keys.
type ttlCache struct {
	ttl  time.Duration
	mu   sync.Mutex
	data map[string]cacheEntry
}

const cacheMaxEntries = 64

func newTTLCache(ttl time.Duration) *ttlCache {
	return &ttlCache{ttl: ttl, data: map[string]cacheEntry{}}
}

func (t *ttlCache) get(key string, now time.Time) (any, bool) {
	if t.ttl <= 0 {
		return nil, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	hit, ok := t.data[key]
	if !ok {
		return nil, false
	}
	if !hit.expires.After(now) {
		delete(t.data, key)
		return nil, false
	}
	return hit.value, true
}

func (t *ttlCache) set(key string, value any, now time.Time) {
	if t.ttl <= 0 {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if len(t.data) >= cacheMaxEntries {
		clear(t.data)
	}
	t.data[key] = cacheEntry{expires: now.Add(t.ttl), value: value}
}

func (t *ttlCache) clear() {
	t.mu.Lock()
	defer t.mu.Unlock()
	clear(t.data)
}

// ------------------------------------------------------------------ HTTP

// call is one in-flight request shared by concurrent callers of the same path.
type call struct {
	done           chan struct{}
	value          any
	err            error
	callerCanceled bool // the leader's own context ended: followers retry with theirs
}

func unreachable(reason string, cause error) *Error {
	return &Error{
		Kind:    ErrUpstream,
		Message: "Could not reach the BCV Today data API (" + reason + "). Try again in a moment.",
		Err:     cause,
	}
}

// getJSON returns the parsed JSON of path (numbers as json.Number), from the cache
// when fresh. Errors are never cached.
func (c *Client) getJSON(ctx context.Context, path string) (any, error) {
	for {
		if v, ok := c.cache.get(path, c.now()); ok {
			return v, nil
		}
		c.mu.Lock()
		if cl, ok := c.inflight[path]; ok {
			c.mu.Unlock()
			select {
			case <-cl.done:
			case <-ctx.Done():
				return nil, unreachable(ctx.Err().Error(), ctx.Err())
			}
			if cl.callerCanceled && ctx.Err() == nil {
				continue
			}
			return cl.value, cl.err
		}
		cl := &call{done: make(chan struct{})}
		c.inflight[path] = cl
		c.mu.Unlock()

		cl.value, cl.err = c.fetch(ctx, path)
		if cl.err == nil {
			c.cache.set(path, cl.value, c.now())
		}
		cl.callerCanceled = cl.err != nil && ctx.Err() != nil
		c.mu.Lock()
		delete(c.inflight, path)
		c.mu.Unlock()
		close(cl.done)
		return cl.value, cl.err
	}
}

func (c *Client) fetch(ctx context.Context, path string) (any, error) {
	reqCtx := ctx
	if c.timeout > 0 {
		var cancel context.CancelFunc
		reqCtx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}
	reason := func(err error) string {
		switch {
		case ctx.Err() != nil:
			return ctx.Err().Error()
		case errors.Is(reqCtx.Err(), context.DeadlineExceeded):
			return "timed out after " + c.timeout.String()
		}
		var ue *url.Error
		if errors.As(err, &ue) {
			return ue.Err.Error()
		}
		return err.Error()
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, unreachable(reason(err), err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, unreachable(reason(err), err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return nil, newError(ErrNotFound, "Not found: %s", path)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return nil, &Error{
			Kind:       ErrUpstream,
			Message:    fmt.Sprintf("The BCV Today data API answered HTTP %d for %s. Try again in a moment.", resp.StatusCode, path),
			StatusCode: resp.StatusCode,
		}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return nil, unreachable(reason(err), err)
	}
	var value any
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if !json.Valid(body) || dec.Decode(&value) != nil {
		return nil, newError(ErrUpstream, "The BCV Today data API returned invalid JSON for %s.", path)
	}
	return value, nil
}

func expectObject(v any, what string) (map[string]any, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, newError(ErrUpstream, "Unexpected %s shape (expected an object).", what)
	}
	return m, nil
}

func (c *Client) today() string { return todayCaracas(c.now()) }

func (c *Client) latestEntry(ctx context.Context) (map[string]any, error) {
	v, err := c.getJSON(ctx, latestPath)
	if err != nil {
		return nil, err
	}
	return expectObject(v, latestPath)
}

func (c *Client) dayEntry(ctx context.Context, date string) (map[string]any, error) {
	if err := checkDay(date, c.today()); err != nil {
		return nil, err
	}
	v, err := c.getJSON(ctx, dayPath(date))
	if errors.Is(err, ErrNotFound) {
		latest := ""
		if r, lerr := c.Latest(ctx); lerr == nil {
			latest = r.Date
		}
		return nil, newError(ErrDateOutOfRange, "%s", notPublishedMessage(date, latest))
	}
	if err != nil {
		return nil, err
	}
	return expectObject(v, "day snapshot")
}

func (c *Client) historyEntries(ctx context.Context) ([]map[string]any, error) {
	v, err := c.getJSON(ctx, historyPath)
	if err != nil {
		return nil, err
	}
	list, ok := v.([]any)
	if !ok {
		return nil, newError(ErrUpstream, "Unexpected history.json shape (expected an array).")
	}
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out, nil
}
