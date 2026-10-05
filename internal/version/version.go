// Package version holds the build version of Squirrel.
package version

import "strings"

// Version is the app version. The build sets it with
// -ldflags "-X github.com/andrewmooreio/squirrel/internal/version.Version=...".
var Version = "dev"

// String is the version for people to read. A release number gets a v, for
// example v1.1.0. Other builds, such as dev or edge-abc1234, stay as they are.
func String() string {
	if Version != "" && strings.IndexByte("0123456789", Version[0]) >= 0 {
		return "v" + Version
	}
	return Version
}
