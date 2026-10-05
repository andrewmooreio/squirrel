package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

// ImportRow is one row of an import file. Line is the line number in the
// file, used to report problems. Count is raw text, so the store checks it
// with the same rule as everywhere else. A blank count means 0.
type ImportRow struct {
	Line     int
	Name     string
	Count    string
	Category string
	Location string
	Store    string
	Notes    string
}

// ImportSkip is a row that ImportItems did not add.
type ImportSkip struct {
	Line   int
	Name   string
	Reason string
}

// ImportResult reports what ImportItems did.
type ImportResult struct {
	Added   int
	Skipped []ImportSkip
}

const skipExists = "An item with this name exists. Squirrel did not change it."

// ImportItems adds the items in rows, all in one transaction. It skips a row
// that is not valid or whose name is taken, and reports why. It creates list
// values that do not exist yet. Only a database error returns an error, and
// then nothing is added.
func (s *Store) ImportItems(ctx context.Context, rows []ImportRow) (ImportResult, error) {
	var res ImportResult
	err := s.tx(ctx, func(tx *sql.Tx) error {
		for _, row := range rows {
			skip := func(reason string) {
				res.Skipped = append(res.Skipped, ImportSkip{Line: row.Line, Name: strings.TrimSpace(row.Name), Reason: reason})
			}
			clean, reason := cleanImportRow(row)
			if reason != "" {
				skip(reason)
				continue
			}

			var exists bool
			if err := tx.QueryRowContext(ctx,
				`SELECT EXISTS (SELECT 1 FROM items WHERE name = ?)`, clean.Name).Scan(&exists); err != nil {
				return err
			}
			if exists {
				skip(skipExists)
				continue
			}

			var ids [3]int64
			for i, ref := range []struct {
				kind ListKind
				name string
			}{
				{Categories, clean.Category},
				{Locations, clean.Location},
				{Stores, clean.Store},
			} {
				id, err := listValueID(ctx, tx, ref.kind, ref.name)
				if err != nil {
					return err
				}
				ids[i] = id
			}

			count, _ := strconv.Atoi(clean.Count) // checked by cleanImportRow
			r, err := tx.ExecContext(ctx, `
				INSERT INTO items (name, count, category_id, location_id, store_id, notes)
				VALUES (?, ?, ?, ?, ?, ?)`,
				clean.Name, count, ids[0], ids[1], ids[2], clean.Notes)
			if err != nil {
				return mapErr(err)
			}
			itemID, err := r.LastInsertId()
			if err != nil {
				return err
			}
			if count > 0 {
				if err := recordChange(ctx, tx, itemID, count, count); err != nil {
					return err
				}
			}
			res.Added++
		}
		return nil
	})
	if err != nil {
		return ImportResult{}, err
	}
	return res, nil
}

// cleanImportRow trims the row. It returns the first problem as a reason, in
// the order name, count, category, location, store, notes.
func cleanImportRow(row ImportRow) (ImportRow, string) {
	msg := func(err error, field string) string {
		var verr *ValidationError
		if errors.As(err, &verr) {
			return verr.Fields[field]
		}
		return err.Error()
	}

	name, err := cleanName(row.Name)
	if err != nil {
		return row, msg(err, "name")
	}
	row.Name = name

	row.Count = strings.TrimSpace(row.Count)
	if row.Count == "" {
		row.Count = "0"
	}
	if n, err := strconv.Atoi(row.Count); err != nil || n < 0 {
		return row, "Enter a whole number of 0 or more."
	}

	for _, f := range []struct {
		val   *string
		label string
	}{
		{&row.Category, "category"},
		{&row.Location, "location"},
		{&row.Store, "store"},
	} {
		v, err := cleanName(*f.val)
		if err != nil {
			if strings.TrimSpace(*f.val) == "" {
				return row, "Enter a " + f.label + "."
			}
			return row, msg(err, "name")
		}
		*f.val = v
	}

	row.Notes = strings.TrimSpace(row.Notes)
	if len(row.Notes) > 2000 {
		return row, "Use 2000 characters or fewer."
	}
	return row, ""
}

// listValueID returns the id of the value with this name, ignoring case, and
// creates the value if it does not exist. The name must be clean.
func listValueID(ctx context.Context, q querier, kind ListKind, name string) (int64, error) {
	if !kind.Valid() {
		return 0, ErrNotFound
	}
	var id int64
	// kind is checked above, so the table name is a constant.
	err := q.QueryRowContext(ctx, `SELECT id FROM `+string(kind)+` WHERE name = ?`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	res, err := q.ExecContext(ctx, `INSERT INTO `+string(kind)+` (name) VALUES (?)`, name)
	if err != nil {
		return 0, mapErr(err)
	}
	return res.LastInsertId()
}
