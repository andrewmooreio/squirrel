// Package views holds the templ components that render Squirrel's pages and
// HTMX fragments.
package views

import (
	"fmt"
	"strconv"
	"time"

	"github.com/andrewmooreio/squirrel/internal/store"
)

// Page carries the values every full page needs.
type Page struct {
	Title string
	// Nav is "lists" when the Manage lists link is the current page.
	Nav string
	// Ver busts the browser cache of the embedded assets.
	Ver string
}

func itemURL(id int64) string { return fmt.Sprintf("/items/%d", id) }

func itemAction(id int64, action string) string {
	return fmt.Sprintf("/items/%d/%s", id, action)
}

func rowID(id int64) string { return fmt.Sprintf("item-%d", id) }

func rowTarget(id int64) string { return "#" + rowID(id) }

func listURL(kind store.ListKind) string { return "/lists/" + string(kind) }

func listValueAction(kind store.ListKind, id int64, action string) string {
	if action == "" {
		return fmt.Sprintf("/lists/%s/%d", kind, id)
	}
	return fmt.Sprintf("/lists/%s/%d/%s", kind, id, action)
}

func dialogID(id int64) string { return fmt.Sprintf("delete-%d", id) }

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func itoa(n int) string { return strconv.Itoa(n) }

func idStr(id int64) string {
	if id == 0 {
		return ""
	}
	return strconv.FormatInt(id, 10)
}

func sel(id, want int64) bool { return id != 0 && id == want }

// kindLabel is the singular name of a list, kindPlural the plural.
func kindLabel(k store.ListKind) string {
	switch k {
	case store.Categories:
		return "category"
	case store.Locations:
		return "location"
	default:
		return "store"
	}
}

func kindPlural(k store.ListKind) string {
	switch k {
	case store.Categories:
		return "Categories"
	case store.Locations:
		return "Locations"
	default:
		return "Stores"
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func fallbackTime(t time.Time) string { return t.UTC().Format("2 Jan 2006 15:04 UTC") }

func delta(d int) string {
	if d > 0 {
		return "+" + strconv.Itoa(d)
	}
	return strconv.Itoa(d)
}
