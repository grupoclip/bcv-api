package bcv_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	bcv "github.com/grupoclip/bcv-api/packages/go"
)

// The recorded API samples shared by every BCV Today client (not copied here).
var fixturesDir = filepath.Join("..", "python", "tests", "fixtures")

// fixtureNow is 2026-11-18 11:00 in Caracas, the day the fixtures were recorded.
var fixtureNow = time.Date(2026, 11, 18, 15, 0, 0, 0, time.UTC)

func fixedClock() time.Time { return fixtureNow }

type reply struct {
	status int
	body   string
}

// fakeAPI serves the fixtures under /api/v1/ like https://bcv.today and records requests.
type fakeAPI struct {
	*httptest.Server
	overrides map[string]reply // keyed by path relative to /api/v1/, e.g. "rate.json"
	delay     atomic.Int64     // nanoseconds to wait before answering

	mu      sync.Mutex
	calls   []string
	headers []http.Header
}

func newFakeAPI(overrides map[string]reply) *fakeAPI {
	f := &fakeAPI{overrides: overrides}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	return f
}

func (f *fakeAPI) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.calls = append(f.calls, r.URL.Path)
	f.headers = append(f.headers, r.Header.Clone())
	f.mu.Unlock()
	if d := time.Duration(f.delay.Load()); d > 0 {
		select {
		case <-time.After(d):
		case <-r.Context().Done():
			return
		}
	}
	rel, ok := strings.CutPrefix(path.Clean(r.URL.Path), "/api/v1/")
	if rep, hit := f.overrides[rel]; ok && hit {
		w.WriteHeader(rep.status)
		_, _ = w.Write([]byte(rep.body))
		return
	}
	body, err := os.ReadFile(filepath.Join(fixturesDir, filepath.FromSlash(rel)))
	if !ok || err != nil {
		http.Error(w, "<html>404</html>", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

// client returns a client for this server with the clock frozen at fixtureNow.
func (f *fakeAPI) client(opts ...bcv.Option) *bcv.Client {
	return bcv.New(append([]bcv.Option{bcv.WithBaseURL(f.URL), bcv.WithClock(fixedClock)}, opts...)...)
}

func (f *fakeAPI) Calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func (f *fakeAPI) Headers() []http.Header {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]http.Header(nil), f.headers...)
}

func (f *fakeAPI) count(p string) int {
	n := 0
	for _, c := range f.Calls() {
		if c == p {
			n++
		}
	}
	return n
}

// newExampleClient serves the recorded fixtures from a local test server, so the
// examples run offline with a deterministic "today" (2026-11-18 in Caracas).
// Real code just calls bcv.New().
func newExampleClient() (*bcv.Client, func()) {
	f := newFakeAPI(nil)
	return f.client(), f.Close
}
