require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const db = require('./database');

const app = express();
/*app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'","'unsafe-inline'"],    // external scripts only
      styleSrc: ["'self'", "'unsafe-inline'"],   // inline styles still needed for some background images
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));*/
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use('/api/', limiter);

// ---------- JWT Middleware ----------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ---------- Role Middleware ----------
function requireRole(roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const role = await db.getUserRole(req.user.id);
      if (roles.includes(role)) {
        req.userRole = role;
        next();
      } else {
        res.status(403).json({ error: 'Forbidden: insufficient privileges' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  };
}

// ---------- Auth Endpoints ----------
app.post('/api/auth/signup',
  body('username').isLength({ min: 3 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('phone').optional().isMobilePhone(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, email, password, phone } = req.body;
    try {
      const existing = await db.getUserByEmailOrUsername(email, username);
      if (existing) return res.status(409).json({ error: 'User already exists' });

      const hashed = await bcrypt.hash(password, 10);
      const userId = await db.createUser(username, email, hashed, phone);
      const token = jwt.sign({ id: userId, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.json({ success: true, token, username });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

app.post('/api/auth/login',
  body('username').notEmpty().trim(),
  body('password').notEmpty(),
  async (req, res) => {
    const { username, password } = req.body;
    try {
      const user = await db.getUserByUsername(username);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.json({ success: true, token, username: user.username });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/update', authenticateToken,
  body('phone').optional().isMobilePhone(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await db.updateUserPhone(req.user.id, req.body.phone);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ---------- Products (public) ----------
app.get('/api/products', async (req, res) => {
  try {
    const products = await db.getAllProducts();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ---------- Cart (authenticated) ----------
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const items = await db.getCartItems(req.user.id);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

app.post('/api/cart', authenticateToken,
  body('productId').isInt(),
  body('quantity').isInt({ min: 1 }),
  async (req, res) => {
    const { productId, quantity } = req.body;
    try {
      await db.addOrUpdateCartItem(req.user.id, productId, quantity);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update cart' });
    }
  }
);

app.delete('/api/cart/:productId', authenticateToken, async (req, res) => {
  try {
    await db.removeCartItem(req.user.id, req.params.productId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

app.post('/api/checkout', authenticateToken, async (req, res) => {
  console.log('=== NEW CHECKOUT ROUTE EXECUTED ===');
  try {
    const cartItems = await db.getCartItems(req.user.id);
    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const orderId = await db.createOrder(req.user.id, total, 'pending');
    for (const item of cartItems) {
      await db.createOrderItem(orderId, item.product_id, item.quantity, item.price);
    }
    await db.clearCart(req.user.id);
    res.json({ orderId, total, mpesaInitiated: false, message: 'Order created (simulation).' });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});
async function getMpesaAccessToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` },
  });
  return response.data.access_token;
}

async function initiateMpesaStkPush(phoneNumber, amount, orderId) {
  const token = await getMpesaAccessToken();
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

  const data = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phoneNumber,
    PartyB: process.env.MPESA_SHORTCODE,
    PhoneNumber: phoneNumber,
    CallBackURL: `${process.env.BASE_URL}/api/mpesa/callback`,
    AccountReference: `ORDER${orderId}`,
    TransactionDesc: `Payment for order ${orderId}`,
  };

  const response = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', data, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
}

app.post('/api/mpesa/callback', express.json(), async (req, res) => {
  const { Body } = req.body;
  if (Body && Body.stkCallback && Body.stkCallback.ResultCode === 0) {
    const checkoutRequestID = Body.stkCallback.CheckoutRequestID;
    const receipt = Body.stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    await db.updateOrderPayment(checkoutRequestID, 'paid', receipt);
  }
  res.json({ ResultCode: 0, ResultDesc: 'OK' });
});

// ---------- Orders (customer) ----------
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await db.getUserOrders(req.user.id);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ---------- ADMIN ROUTES ----------
app.get('/api/admin/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id/role', authenticateToken, requireRole(['admin']),
  body('role').isIn(['customer', 'vendor', 'admin']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await db.updateUserRole(req.params.id, req.body.role);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.delete('/api/admin/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await db.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/orders', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const orders = await db.getAllOrdersWithUser();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/orders/:id/status', authenticateToken, requireRole(['admin']),
  body('status').isIn(['pending', 'paid', 'shipped', 'delivered', 'cancelled']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      await db.updateOrderStatus(req.params.id, req.body.status);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ---------- VENDOR ROUTES (product management) ----------
app.get('/api/vendor/products', authenticateToken, requireRole(['vendor', 'admin']), async (req, res) => {
  try {
    const products = await db.getAllProducts();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vendor/products', authenticateToken, requireRole(['vendor', 'admin']),
  body('name').notEmpty(), body('price').isFloat({ min: 0 }), body('stock').isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, price, description, stock, image_url } = req.body;
    try {
      const id = await db.createProduct(name, price, description, stock, image_url);
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.put('/api/vendor/products/:id', authenticateToken, requireRole(['vendor', 'admin']),
  body('name').notEmpty(), body('price').isFloat({ min: 0 }), body('stock').isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, price, description, stock, image_url } = req.body;
    try {
      await db.updateProduct(req.params.id, name, price, description, stock, image_url);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.delete('/api/vendor/products/:id', authenticateToken, requireRole(['vendor', 'admin']), async (req, res) => {
  try {
    await db.deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
