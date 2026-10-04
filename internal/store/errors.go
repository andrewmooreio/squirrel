package store

import (
	"errors"
	"sort"
	"strings"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

var (
	// ErrNotFound means the item, list value or change does not exist.
	ErrNotFound = errors.New("not found")
	// ErrDuplicate means another row in the same list already has the name.
	ErrDuplicate = errors.New("name already in use")
	// ErrBelowZero means the change would make a count negative.
	ErrBelowZero = errors.New("count would go below zero")
)

// ValidationError lists invalid fields with a message for each.
type ValidationError struct {
	Fields map[string]string
}

func (e *ValidationError) Error() string {
	keys := make([]string, 0, len(e.Fields))
	for k := range e.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+": "+e.Fields[k])
	}
	return "validation failed: " + strings.Join(parts, "; ")
}

func invalid(field, msg string) *ValidationError {
	return &ValidationError{Fields: map[string]string{field: msg}}
}

// mapErr turns SQLite constraint errors into the store's typed errors.
func mapErr(err error) error {
	var se *sqlite.Error
	if !errors.As(err, &se) {
		return err
	}
	switch se.Code() {
	case sqlite3.SQLITE_CONSTRAINT_UNIQUE:
		return ErrDuplicate
	case sqlite3.SQLITE_CONSTRAINT_CHECK:
		if strings.Contains(se.Error(), "count") {
			return ErrBelowZero
		}
	}
	return err
}
