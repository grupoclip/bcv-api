package bcv

import (
	"errors"
	"fmt"
)

// Sentinel errors, one per error category. Every error returned on purpose by this
// package is an [*Error] whose Kind is one of them, so both styles work:
//
//	if errors.Is(err, bcv.ErrDateOutOfRange) { ... }
//
//	var e *bcv.Error
//	if errors.As(err, &e) && e.StatusCode == 503 { ... }
//
// The categories mirror the Python, JavaScript and PHP clients:
//
//	ErrInvalidArgument          an argument passed by the caller is invalid
//	├── ErrInvalidDate          bad date string, not a real calendar day, bad range or days
//	├── ErrInvalidCurrency      unknown currency code, or from == to
//	└── ErrInvalidAmount        negative, non-finite or too large amount, bad decimals
//	ErrDateOutOfRange           before 2021-08-02, in the future, not published yet,
//	                            or outside the range covered by history.json
//	ErrCurrencyNotAvailable     valid code, but no rate for it that day
//	ErrNotFound                 the API answered HTTP 404
//	ErrUpstream                 network failure, timeout, HTTP error or invalid JSON
//
// errors.Is(err, ErrInvalidArgument) is true for the three invalid-argument kinds.
var (
	ErrInvalidArgument      = errors.New("bcv: invalid argument")
	ErrInvalidDate          = errors.New("bcv: invalid date")
	ErrInvalidCurrency      = errors.New("bcv: invalid currency")
	ErrInvalidAmount        = errors.New("bcv: invalid amount")
	ErrDateOutOfRange       = errors.New("bcv: date out of range")
	ErrCurrencyNotAvailable = errors.New("bcv: currency not available")
	ErrNotFound             = errors.New("bcv: not found")
	ErrUpstream             = errors.New("bcv: upstream error")
)

// Error is the concrete type of every error returned on purpose by this package.
type Error struct {
	// Kind is one of the sentinel errors (ErrInvalidDate, ErrUpstream, ...).
	Kind error
	// Message is the user-facing English message, identical to the other BCV Today clients.
	Message string
	// StatusCode is the HTTP status when the error came from an HTTP response (ErrUpstream), else 0.
	StatusCode int
	// Err is the underlying cause (network error, context error), if any.
	Err error
}

// Error returns Message.
func (e *Error) Error() string { return e.Message }

// Unwrap returns the underlying cause, so errors.Is(err, context.Canceled) works.
func (e *Error) Unwrap() error { return e.Err }

// Is reports whether target is the error's Kind, or ErrInvalidArgument for the
// invalid-date, invalid-currency and invalid-amount kinds.
func (e *Error) Is(target error) bool {
	if target == e.Kind {
		return true
	}
	if target == ErrInvalidArgument {
		return e.Kind == ErrInvalidDate || e.Kind == ErrInvalidCurrency || e.Kind == ErrInvalidAmount
	}
	return false
}

// Type is the name of the error category, the same as the Python/JavaScript class
// names: "InvalidDate", "InvalidCurrency", "InvalidAmount", "InvalidArgument",
// "DateOutOfRange", "CurrencyNotAvailable", "NotFound" or "UpstreamError".
func (e *Error) Type() string {
	switch e.Kind {
	case ErrInvalidDate:
		return "InvalidDate"
	case ErrInvalidCurrency:
		return "InvalidCurrency"
	case ErrInvalidAmount:
		return "InvalidAmount"
	case ErrInvalidArgument:
		return "InvalidArgument"
	case ErrDateOutOfRange:
		return "DateOutOfRange"
	case ErrCurrencyNotAvailable:
		return "CurrencyNotAvailable"
	case ErrNotFound:
		return "NotFound"
	default:
		return "UpstreamError"
	}
}

func newError(kind error, format string, args ...any) *Error {
	return &Error{Kind: kind, Message: fmt.Sprintf(format, args...)}
}
