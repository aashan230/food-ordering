// =============================================================
// server.js  -  Online Food Ordering System
// Express + SQLite (auto-creates DB file and seeds dummy data)
// =============================================================

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors    = require('cors');
const path    = require('path');

const app     = express();
const PORT    = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'food_ordering.db');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Database connection ----------
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Failed to open database:', err.message);
        process.exit(1);
    }
});

// Tiny promise wrappers for sqlite3
const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
    });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// ---------- Initialize schema + seed dummy data ----------
async function initializeDatabase() {
    await run(`
        CREATE TABLE IF NOT EXISTS MenuItems (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            description TEXT,
            price       REAL NOT NULL CHECK (price > 0)
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS Orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name   TEXT NOT NULL,
            total_price     REAL NOT NULL,
            delivery_status TEXT NOT NULL DEFAULT 'Pending',
            created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS OrderItems (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id     INTEGER NOT NULL,
            menu_item_id INTEGER NOT NULL,
            quantity     INTEGER NOT NULL CHECK (quantity > 0),
            FOREIGN KEY (order_id)     REFERENCES Orders(id)    ON DELETE CASCADE,
            FOREIGN KEY (menu_item_id) REFERENCES MenuItems(id)
        )
    `);

    // Seed menu items only if table is empty
    const { c: menuCount } = await get("SELECT COUNT(*) AS c FROM MenuItems");
    if (menuCount === 0) {
        const items = [
            ['Chicken Biryani',  'Spicy chicken biryani served with raita',    450],
            ['Beef Karahi',      'Half kg traditional Pakistani beef karahi', 1200],
            ['Margherita Pizza', 'Classic tomato and mozzarella, medium',      950],
            ['Zinger Burger',    'Crispy fried chicken zinger burger',         450],
            ['Chocolate Cake',   '1 lb fresh cream chocolate cake',           1200],
            ['Cold Coffee',      'Iced coffee blended with whipped cream',     350]
        ];
        for (const it of items) {
            await run("INSERT INTO MenuItems (name, description, price) VALUES (?, ?, ?)", it);
        }
        console.log('Seeded 6 menu items.');
    }

    // Seed 3 sample orders only if Orders table is empty
    const { c: orderCount } = await get("SELECT COUNT(*) AS c FROM Orders");
    if (orderCount === 0) {
        // Order 1: 2x Biryani = 900  -> Delivered
        const o1 = await run(
            "INSERT INTO Orders (customer_name, total_price, delivery_status) VALUES (?, ?, ?)",
            ['Ahmed Raza', 900, 'Delivered']
        );
        await run("INSERT INTO OrderItems (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [o1.lastID, 1, 2]);

        // Order 2: 1x Pizza + 1x Zinger = 1400  -> Preparing
        const o2 = await run(
            "INSERT INTO Orders (customer_name, total_price, delivery_status) VALUES (?, ?, ?)",
            ['Fatima Khan', 1400, 'Preparing']
        );
        await run("INSERT INTO OrderItems (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [o2.lastID, 3, 1]);
        await run("INSERT INTO OrderItems (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [o2.lastID, 4, 1]);

        // Order 3: 1x Karahi + 1x Zinger = 1650  -> Out for Delivery
        const o3 = await run(
            "INSERT INTO Orders (customer_name, total_price, delivery_status) VALUES (?, ?, ?)",
            ['Bilal Ahmad', 1650, 'Out for Delivery']
        );
        await run("INSERT INTO OrderItems (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [o3.lastID, 2, 1]);
        await run("INSERT INTO OrderItems (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [o3.lastID, 4, 1]);

        console.log('Seeded 3 sample orders.');
    }
}

// =============================================================
// API ROUTES
// =============================================================

// GET /api/menu  ->  all menu items
app.get('/api/menu', async (req, res) => {
    try {
        const rows = await all("SELECT * FROM MenuItems ORDER BY id");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/orders  ->  create new order
// Body: { customer_name: "...", items: [{ menu_item_id, quantity }, ...] }
app.post('/api/orders', async (req, res) => {
    try {
        const { customer_name, items } = req.body;

        if (!customer_name || typeof customer_name !== 'string') {
            return res.status(400).json({ error: 'customer_name is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items[] is required and must be non-empty' });
        }

        // Validate and compute total from server-side prices (never trust client)
        const ids = items.map(i => i.menu_item_id);
        const placeholders = ids.map(() => '?').join(',');
        const priced = await all(
            `SELECT id, price FROM MenuItems WHERE id IN (${placeholders})`, ids
        );
        const priceMap = Object.fromEntries(priced.map(r => [r.id, r.price]));

        let total = 0;
        for (const it of items) {
            if (!priceMap[it.menu_item_id]) {
                return res.status(400).json({ error: `Invalid menu_item_id: ${it.menu_item_id}` });
            }
            if (!Number.isInteger(it.quantity) || it.quantity < 1) {
                return res.status(400).json({ error: 'quantity must be a positive integer' });
            }
            total += priceMap[it.menu_item_id] * it.quantity;
        }

        // Insert order
        const order = await run(
            "INSERT INTO Orders (customer_name, total_price, delivery_status) VALUES (?, ?, 'Pending')",
            [customer_name, total]
        );

        // Insert order items
        for (const it of items) {
            await run(
                "INSERT INTO OrderItems (order_id, menu_item_id, quantity) VALUES (?, ?, ?)",
                [order.lastID, it.menu_item_id, it.quantity]
            );
        }

        res.json({
            order_id: order.lastID,
            customer_name,
            total_price: total,
            delivery_status: 'Pending'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/orders/:id  ->  order details + items + delivery status
app.get('/api/orders/:id', async (req, res) => {
    try {
        const order = await get("SELECT * FROM Orders WHERE id = ?", [req.params.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });

        const items = await all(`
            SELECT oi.quantity, m.name, m.price, (oi.quantity * m.price) AS subtotal
            FROM OrderItems oi
            JOIN MenuItems  m ON oi.menu_item_id = m.id
            WHERE oi.order_id = ?
        `, [req.params.id]);

        res.json({ ...order, items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================
// START SERVER
// =============================================================
initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`\n  Server running:  http://localhost:${PORT}\n`);
        });
    })
    .catch(err => {
        console.error('Initialization failed:', err);
        process.exit(1);
    });
