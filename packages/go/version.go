package bcv

// Version is the version of this module, sent in the default User-Agent header.
const Version = "1.0.0"

// DefaultUserAgent is the User-Agent header sent unless [WithUserAgent] changes it.
const DefaultUserAgent = "bcv-today-go/" + Version + " (+https://bcv.today)"
