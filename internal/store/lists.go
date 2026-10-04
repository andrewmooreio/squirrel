package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// ListKind names one of the managed lists.
type ListKind string

// The managed lists.
const (
	Categories ListKind = "categories"
	Locations  ListKind = "locations"
	Stores     ListKind = "stores"
)

// ListKinds is every managed list, in display order.
var ListKinds = []ListKind{Categories, Locations, Stores}

// Valid reports whether k is a known list.
func (k ListKind) Valid() bool {
	switch k {
	case Categories, Locations, Stores:
		return true
	}
	return false
}

// column is the items column that references this list.
func (k ListKind) column() string {
	switch k {
	case Categories:
		return "category_id"
	case Locations:
		return "location_id"
	default:
		return "store_id"
	}
}

// ListValue is one entry in a managed list.
type ListValue struct {
	ID   int64
	Name string
	// Uses is the number of items that reference this value.
	Uses int
}

// Lists returns every value in the list, sorted by name, with usage counts.
func (s *Store) Lists(ctx context.Context, kind ListKind) ([]ListValue, error) {
	if !kind.Valid() {
		return nil, ErrNotFound
	}
	// kind is checked above, so the table and column names are constants.
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id, l.name, count(i.id)
		FROM `+string(kind)+` l
		LEFT JOIN items i ON i.`+kind.column()+` = l.id
		GROUP BY l.id
		ORDER BY l.name COLLATE NOCASE, l.id`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []ListValue
	for rows.Next() {
		var v ListValue
		if err := rows.Scan(&v.ID, &v.Name, &v.Uses); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetListValue returns one list value with its usage count.
func (s *Store) GetListValue(ctx context.Context, kind ListKind, id int64) (ListValue, error) {
	if !kind.Valid() {
		return ListValue{}, ErrNotFound
	}
	v := ListValue{ID: id}
	err := s.db.QueryRowContext(ctx, `
		SELECT l.name, (SELECT count(*) FROM items WHERE `+kind.column()+` = l.id)
		FROM `+string(kind)+` l WHERE l.id = ?`, id).Scan(&v.Name, &v.Uses)
	if errors.Is(err, sql.ErrNoRows) {
		return ListValue{}, ErrNotFound
	}
	return v, err
}

// CreateListValue adds a value to a list and returns its id.
func (s *Store) CreateListValue(ctx context.Context, kind ListKind, name string) (int64, error) {
	if !kind.Valid() {
		return 0, ErrNotFound
	}
	name, err := cleanName(name)
	if err != nil {
		return 0, err
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO `+string(kind)+` (name) VALUES (?)`, name)
	if err != nil {
		return 0, mapErr(err)
	}
	return res.LastInsertId()
}

// RenameListValue changes the name of a list value.
func (s *Store) RenameListValue(ctx context.Context, kind ListKind, id int64, name string) error {
	if !kind.Valid() {
		return ErrNotFound
	}
	name, err := cleanName(name)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `UPDATE `+string(kind)+` SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return mapErr(err)
	}
	return mustAffect(res)
}

// DeleteListValue deletes a list value. Items that used it keep existing,
// with that field left blank.
func (s *Store) DeleteListValue(ctx context.Context, kind ListKind, id int64) error {
	if !kind.Valid() {
		return ErrNotFound
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM `+string(kind)+` WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return mustAffect(res)
}

func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", invalid("name", "Enter a name.")
	}
	if len(name) > 100 {
		return "", invalid("name", "Use 100 characters or fewer.")
	}
	return name, nil
}

func mustAffect(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
