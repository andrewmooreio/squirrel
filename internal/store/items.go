package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Item is one tracked thing. A zero CategoryID, LocationID or StoreID means
// the value was deleted and the field is blank.
type Item struct {
	ID           int64
	Name         string
	Count        int
	CategoryID   int64
	CategoryName string
	LocationID   int64
	LocationName string
	StoreID      int64
	StoreName    string
	Notes        string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// ItemInput holds the editable fields of an item. Count is used only by
// CreateItem; use Adjust or SetCount to change the count of an existing item.
type ItemInput struct {
	Name       string
	Count      int
	CategoryID int64
	LocationID int64
	StoreID    int64
	Notes      string
}

// ItemFilter narrows ListItems. Zero values mean "any".
type ItemFilter struct {
	CategoryID    int64
	Uncategorised bool
	LocationID    int64
	StoreID       int64
	Search        string
	// OutOfStock keeps only the items with a count of 0.
	OutOfStock bool
	// Sort picks the order of the result. Use SortName, SortNameDesc,
	// SortCount or SortUpdated. Any other value sorts by name.
	Sort string
}

// Sort orders for ItemFilter.Sort.
const (
	// SortName orders by name. It is the default.
	SortName = ""
	// SortNameDesc orders by name, Z to A.
	SortNameDesc = "name-desc"
	// SortCount orders by count, lowest first.
	SortCount = "count"
	// SortUpdated orders by the most recent change first.
	SortUpdated = "updated"
)

// Change is one recorded count change. Count is the count after the change.
type Change struct {
	ID        int64
	Delta     int
	Count     int
	CreatedAt time.Time
}

const itemSelect = `
	SELECT i.id, i.name, i.count,
	       coalesce(i.category_id, 0), coalesce(c.name, ''),
	       coalesce(i.location_id, 0), coalesce(l.name, ''),
	       coalesce(i.store_id, 0), coalesce(s.name, ''),
	       i.notes, i.created_at, i.updated_at
	FROM items i
	LEFT JOIN categories c ON c.id = i.category_id
	LEFT JOIN locations l ON l.id = i.location_id
	LEFT JOIN stores s ON s.id = i.store_id`

type scanner interface{ Scan(dest ...any) error }

func scanItem(r scanner) (Item, error) {
	var it Item
	var created, updated string
	err := r.Scan(&it.ID, &it.Name, &it.Count,
		&it.CategoryID, &it.CategoryName,
		&it.LocationID, &it.LocationName,
		&it.StoreID, &it.StoreName,
		&it.Notes, &created, &updated)
	if err != nil {
		return Item{}, err
	}
	it.CreatedAt, it.UpdatedAt = parseTime(created), parseTime(updated)
	return it, nil
}

// ListItems returns the items that match f, sorted by name.
func (s *Store) ListItems(ctx context.Context, f ItemFilter) ([]Item, error) {
	var where []string
	var args []any
	switch {
	case f.Uncategorised:
		where = append(where, "i.category_id IS NULL")
	case f.CategoryID != 0:
		where = append(where, "i.category_id = ?")
		args = append(args, f.CategoryID)
	}
	if f.LocationID != 0 {
		where = append(where, "i.location_id = ?")
		args = append(args, f.LocationID)
	}
	if f.StoreID != 0 {
		where = append(where, "i.store_id = ?")
		args = append(args, f.StoreID)
	}
	if f.OutOfStock {
		where = append(where, "i.count = 0")
	}
	if q := strings.TrimSpace(f.Search); q != "" {
		where = append(where, `i.name LIKE ? ESCAPE '\'`)
		args = append(args, "%"+escapeLike(q)+"%")
	}

	query := itemSelect
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	switch f.Sort {
	case SortNameDesc:
		query += " ORDER BY i.name COLLATE NOCASE DESC, i.id DESC"
	case SortCount:
		query += " ORDER BY i.count, i.name COLLATE NOCASE, i.id"
	case SortUpdated:
		query += " ORDER BY i.updated_at DESC, i.name COLLATE NOCASE, i.id"
	default:
		query += " ORDER BY i.name COLLATE NOCASE, i.id"
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Item
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// HasUncategorised reports whether any item has no category.
func (s *Store) HasUncategorised(ctx context.Context) (bool, error) {
	var ok bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM items WHERE category_id IS NULL)`).Scan(&ok)
	return ok, err
}

// GetItem returns one item.
func (s *Store) GetItem(ctx context.Context, id int64) (Item, error) {
	return getItem(ctx, s.db, id)
}

func getItem(ctx context.Context, q querier, id int64) (Item, error) {
	it, err := scanItem(q.QueryRowContext(ctx, itemSelect+" WHERE i.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return it, err
}

// CreateItem adds an item. Name, category, location and store are required.
// A starting count above zero is recorded as the first change.
func (s *Store) CreateItem(ctx context.Context, in ItemInput) (Item, error) {
	in, err := s.validate(ctx, in)
	if err != nil {
		return Item{}, err
	}
	if in.Count < 0 {
		return Item{}, invalid("count", "Enter a whole number of 0 or more.")
	}

	var id int64
	err = s.tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO items (name, count, category_id, location_id, store_id, notes)
			VALUES (?, ?, ?, ?, ?, ?)`,
			in.Name, in.Count, in.CategoryID, in.LocationID, in.StoreID, in.Notes)
		if err != nil {
			return mapErr(err)
		}
		if id, err = res.LastInsertId(); err != nil {
			return err
		}
		if in.Count > 0 {
			return recordChange(ctx, tx, id, in.Count, in.Count)
		}
		return nil
	})
	if err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, id)
}

// UpdateItem changes an item's fields (not its count). Name, category,
// location and store are required, so blank fields must be filled in.
func (s *Store) UpdateItem(ctx context.Context, id int64, in ItemInput) (Item, error) {
	in, err := s.validate(ctx, in)
	if err != nil {
		return Item{}, err
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE items
		SET name = ?, category_id = ?, location_id = ?, store_id = ?, notes = ?, updated_at = ?
		WHERE id = ?`,
		in.Name, in.CategoryID, in.LocationID, in.StoreID, in.Notes, now(), id)
	if err != nil {
		return Item{}, mapErr(err)
	}
	if err := mustAffect(res); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, id)
}

// DeleteItem deletes an item and its history.
func (s *Store) DeleteItem(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM items WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return mustAffect(res)
}

// validate trims the input and checks required fields, including that each
// referenced list value exists.
func (s *Store) validate(ctx context.Context, in ItemInput) (ItemInput, error) {
	fields := map[string]string{}
	name, err := cleanName(in.Name)
	if err != nil {
		var verr *ValidationError
		if errors.As(err, &verr) {
			fields["name"] = verr.Fields["name"]
		}
	}
	in.Name = name
	in.Notes = strings.TrimSpace(in.Notes)
	if len(in.Notes) > 2000 {
		fields["notes"] = "Use 2000 characters or fewer."
	}

	for _, ref := range []struct {
		kind  ListKind
		field string
		id    int64
		label string
	}{
		{Categories, "category", in.CategoryID, "a category"},
		{Locations, "location", in.LocationID, "a location"},
		{Stores, "store", in.StoreID, "a store"},
	} {
		if ref.id == 0 {
			fields[ref.field] = "Choose " + ref.label + "."
			continue
		}
		var ok bool
		if err := s.db.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM `+string(ref.kind)+` WHERE id = ?)`, ref.id).Scan(&ok); err != nil {
			return in, err
		}
		if !ok {
			fields[ref.field] = "Choose " + ref.label + "."
		}
	}

	if len(fields) > 0 {
		return in, &ValidationError{Fields: fields}
	}
	return in, nil
}

// Adjust adds delta to the item's count atomically and records the change.
// It returns ErrBelowZero, and changes nothing, if the count would go below
// zero.
func (s *Store) Adjust(ctx context.Context, id int64, delta int) (Item, error) {
	if delta == 0 {
		return s.GetItem(ctx, id)
	}
	var item Item
	err := s.tx(ctx, func(tx *sql.Tx) error {
		count, err := addCount(ctx, tx, id, delta)
		if err != nil {
			return err
		}
		if err := recordChange(ctx, tx, id, delta, count); err != nil {
			return err
		}
		item, err = getItem(ctx, tx, id)
		return err
	})
	return item, err
}

// SetCount sets the item's count to an exact value and records the
// difference as a change. Setting the current value records nothing.
func (s *Store) SetCount(ctx context.Context, id int64, count int) (Item, error) {
	if count < 0 {
		return Item{}, invalid("count", "Enter a whole number of 0 or more.")
	}
	var item Item
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var old int
		err := tx.QueryRowContext(ctx, `SELECT count FROM items WHERE id = ?`, id).Scan(&old)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if delta := count - old; delta != 0 {
			if _, err := addCount(ctx, tx, id, delta); err != nil {
				return err
			}
			if err := recordChange(ctx, tx, id, delta, count); err != nil {
				return err
			}
		}
		item, err = getItem(ctx, tx, id)
		return err
	})
	return item, err
}

// Undo reverses the most recent change of an item and deletes that change.
// It returns ErrNotFound if there is no change to undo, and ErrBelowZero if
// reversing it would make the count negative.
func (s *Store) Undo(ctx context.Context, id int64) (Item, error) {
	var item Item
	err := s.tx(ctx, func(tx *sql.Tx) error {
		var changeID int64
		var delta int
		err := tx.QueryRowContext(ctx,
			`SELECT id, delta FROM changes WHERE item_id = ? ORDER BY id DESC LIMIT 1`, id).Scan(&changeID, &delta)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := addCount(ctx, tx, id, -delta); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM changes WHERE id = ?`, changeID); err != nil {
			return err
		}
		item, err = getItem(ctx, tx, id)
		return err
	})
	return item, err
}

// History returns the latest n changes of an item, newest first.
func (s *Store) History(ctx context.Context, id int64, n int) ([]Change, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, delta, count, created_at FROM changes
		WHERE item_id = ? ORDER BY id DESC LIMIT ?`, id, n)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Change
	for rows.Next() {
		var c Change
		var created string
		if err := rows.Scan(&c.ID, &c.Delta, &c.Count, &created); err != nil {
			return nil, err
		}
		c.CreatedAt = parseTime(created)
		out = append(out, c)
	}
	return out, rows.Err()
}

// addCount is the single atomic update for every count change. The
// CHECK (count >= 0) constraint rejects a negative result.
func addCount(ctx context.Context, tx *sql.Tx, id int64, delta int) (int, error) {
	var count int
	err := tx.QueryRowContext(ctx,
		`UPDATE items SET count = count + ?, updated_at = ? WHERE id = ? RETURNING count`,
		delta, now(), id).Scan(&count)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, mapErr(err)
	}
	return count, nil
}

func recordChange(ctx context.Context, tx *sql.Tx, id int64, delta, count int) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO changes (item_id, delta, count, created_at) VALUES (?, ?, ?, ?)`,
		id, delta, count, now())
	return err
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
