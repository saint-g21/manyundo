const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const dbPath = path.resolve(__dirname, process.env.DB_PATH || 'wholesalers.db');

const db = new sqlite3.Database(dbPath);

// Create tables and seed default data
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'customer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    image_url TEXT,
    stock INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(product_id) REFERENCES products(id),
    UNIQUE(user_id, product_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    mpesa_receipt TEXT,
    checkout_request_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  // Insert sample products if empty
  db.get(`SELECT COUNT(*) as count FROM products`, (err, row) => {
    if (row && row.count === 0) {
      const sampleProducts = [
        ['Screwdriver', 5, 'Essential tool', '/pictures/screwdriver.jpeg', 100],
        ['Shovel', 25, 'Heavy duty', '/pictures/shovel.jpeg', 50],
        ['Wheelbarrow', 90, 'Garden wheelbarrow', '/pictures/wheelbarrow.jpeg', 20],
        ['Wrench', 20, 'Adjustable wrench', '/pictures/wrench.jpeg', 75],
        ['Nails', 3, 'Box of nails', '/pictures/nails.jpeg', 500],
      ];
      const stmt = db.prepare(`INSERT INTO products (name, price, description, image_url, stock) VALUES (?,?,?,?,?)`);
      for (const p of sampleProducts) stmt.run(p);
      stmt.finalize();
    }
  });

  // Create default admin and vendor if they don't exist
  db.get(`SELECT * FROM users WHERE username = ?`, ['admin'], (err, row) => {
    if (!row) {
      const hashed = bcrypt.hashSync('admin123', 10);
      db.run(`INSERT INTO users (username, email, password_hash, phone, role) VALUES (?,?,?,?,?)`,
        ['admin', 'admin@manyundo.com', hashed, '0712345678', 'admin']);
    }
  });
  db.get(`SELECT * FROM users WHERE username = ?`, ['vendor'], (err, row) => {
    if (!row) {
      const hashed = bcrypt.hashSync('vendor123', 10);
      db.run(`INSERT INTO users (username, email, password_hash, phone, role) VALUES (?,?,?,?,?)`,
        ['vendor', 'vendor@manyundo.com', hashed, '0722334455', 'vendor']);
    }
  });
});

// Helper functions (all return Promises)
module.exports = {
  getUserByEmailOrUsername: (email, username) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE email = ? OR username = ?`, [email, username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  getUserById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  getUserRole: (userId) => {
    return new Promise((resolve, reject) => {
      db.get(`SELECT role FROM users WHERE id = ?`, [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.role : null);
      });
    });
  },
  createUser: (username, email, passwordHash, phone) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO users (username, email, password_hash, phone) VALUES (?,?,?,?)`,
        [username, email, passwordHash, phone], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },
  getAllProducts: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM products`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  getCartItems: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT cart.product_id, products.name, products.price, cart.quantity
              FROM cart JOIN products ON cart.product_id = products.id
              WHERE cart.user_id = ?`, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  addOrUpdateCartItem: (userId, productId, quantity) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO cart (user_id, product_id, quantity) VALUES (?,?,?)
              ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + ?`,
              [userId, productId, quantity, quantity], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  removeCartItem: (userId, productId) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM cart WHERE user_id = ? AND product_id = ?`, [userId, productId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  clearCart: (userId) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM cart WHERE user_id = ?`, [userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  createOrder: (userId, total, status) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO orders (user_id, total_amount, status) VALUES (?,?,?)`,
        [userId, total, status], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },
  createOrderItem: (orderId, productId, quantity, price) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)`,
        [orderId, productId, quantity, price], (err) => {
          if (err) reject(err);
          else resolve();
        });
    });
  },
  getUserOrders: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  // Admin methods
  getAllUsers: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT id, username, email, phone, role, created_at FROM users`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  updateUserRole: (userId, newRole) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE users SET role = ? WHERE id = ?`, [newRole, userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  deleteUser: (userId) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM users WHERE id = ?`, [userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  getAllOrdersWithUser: () => {
    return new Promise((resolve, reject) => {
      db.all(`SELECT orders.*, users.username FROM orders JOIN users ON orders.user_id = users.id ORDER BY orders.created_at DESC`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  updateOrderStatus: (orderId, status) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, orderId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  // Product management for vendor/admin
  createProduct: (name, price, description, stock, image_url = null) => {
    return new Promise((resolve, reject) => {
      db.run(`INSERT INTO products (name, price, description, stock, image_url) VALUES (?,?,?,?,?)`,
        [name, price, description, stock, image_url], function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        });
    });
  },
  updateProduct: (id, name, price, description, stock, image_url = null) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE products SET name=?, price=?, description=?, stock=?, image_url=? WHERE id=?`,
        [name, price, description, stock, image_url, id], (err) => {
          if (err) reject(err);
          else resolve();
        });
    });
  },
  deleteProduct: (id) => {
    return new Promise((resolve, reject) => {
      db.run(`DELETE FROM products WHERE id = ?`, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  updateUserPhone: (userId, phone) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE users SET phone = ? WHERE id = ?`, [phone, userId], (err) => {
        if (err) reject(err);
        else resolve();
       });
     });
  },
  // M-Pesa callback update
  updateOrderPayment: (checkoutRequestID, status, receipt) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE orders SET status = ?, mpesa_receipt = ? WHERE checkout_request_id = ?`, 
        [status, receipt, checkoutRequestID], (err) => {
          if (err) reject(err);
          else resolve();
        });
    });
  },
  // Optional: store checkout ID when initiating payment
  setOrderCheckoutId: (orderId, checkoutRequestID) => {
    return new Promise((resolve, reject) => {
      db.run(`UPDATE orders SET checkout_request_id = ? WHERE id = ?`, [checkoutRequestID, orderId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};
