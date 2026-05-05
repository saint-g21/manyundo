// ========== HELPERS ==========
function authHeader() {
  const token = localStorage.getItem('token');
  return { 'Authorization': `Bearer ${token}` };
}

function isLoggedIn() {
  return !!localStorage.getItem('token');
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

async function getCurrentUser() {
  if (!isLoggedIn()) return null;
  try {
    const res = await fetch('/api/auth/me', { headers: authHeader() });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ========== AUTH ==========
async function signup(username, email, password, phone) {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, phone })
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.errors && Array.isArray(data.errors))
      throw new Error(data.errors.map(e => e.msg).join(', '));
    throw new Error(data.error || 'Signup failed');
  }
  localStorage.setItem('token', data.token);
  localStorage.setItem('username', data.username);
  return data;
}

async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  localStorage.setItem('token', data.token);
  localStorage.setItem('username', data.username);
  return data;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  window.location.href = '/login.html';
}

// ========== PRODUCTS ==========
async function loadProducts() {
  const res = await fetch('/api/products');
  if (!res.ok) throw new Error('Failed to load products');
  return await res.json();
}

function renderProducts(containerId, products) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (products.length === 0) {
    container.innerHTML = '<p>No products available.</p>';
    return;
  }
  container.innerHTML = products.map(p => `
    <div class="product-card">
      <img src="${p.image_url || 'https://via.placeholder.com/150'}" alt="${p.name}">
      <h3>${p.name}</h3>
      <p>$${p.price}</p>
      <p>Stock: ${p.stock}</p>
      <button onclick="addToCartAndRefresh(${p.id})">Add to Cart</button>
    </div>
  `).join('');
}

// ========== CART ==========
async function getCart() {
  const res = await fetch('/api/cart', { headers: authHeader() });
  if (!res.ok) throw new Error('Failed to fetch cart');
  return await res.json();
}

async function addToCart(productId, quantity = 1) {
  const res = await fetch('/api/cart', {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantity })
  });
  if (!res.ok) throw new Error('Failed to add to cart');
  return await res.json();
}

async function addToCartAndRefresh(productId) {
  try {
    await addToCart(productId);
    alert('Added to cart!');
  } catch (err) {
    alert(err.message);
  }
}

async function removeCartItem(productId) {
  const res = await fetch(`/api/cart/${productId}`, { method: 'DELETE', headers: authHeader() });
  if (!res.ok) throw new Error('Failed to remove item');
  renderCart();
}

async function renderCart() {
  const tbody = document.getElementById('cartItems');
  const totalSpan = document.getElementById('cartTotal');
  if (!tbody) return;
  try {
    const items = await getCart();
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">Your cart is empty.</td></tr>';
      totalSpan.innerText = 'Total: $0.00';
      return;
    }
    let total = 0;
    tbody.innerHTML = items.map(item => {
      const subtotal = item.price * item.quantity;
      total += subtotal;
      return `
        <tr>
          <td>${item.name}</td>
          <td>$${item.price}</td>
          <td>${item.quantity}</td>
          <td>$${subtotal.toFixed(2)}</td>
          <td><button class="remove-btn" onclick="removeCartItem(${item.product_id})">Remove</button></td>
        </tr>
      `;
    }).join('');
    totalSpan.innerText = `Total: $${total.toFixed(2)}`;
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="5">Error loading cart.</td></tr>';
  }
}

// ========== CHECKOUT ==========
async function proceedCheckout() {
  try {
    const res = await fetch('/api/checkout', { method: 'POST', headers: authHeader() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed');
    if (data.mpesaInitiated) {
      alert('M-Pesa STK push sent to your phone. Complete payment to finalize order.');
    } else {
      alert('Order created but no phone number on file. Please update your profile.');
    }
    window.location.href = '/orders.html';
  } catch (err) {
    alert(err.message);
  }
}

// ========== ORDERS ==========
async function getOrders() {
  const res = await fetch('/api/orders', { headers: authHeader() });
  if (!res.ok) throw new Error('Failed to fetch orders');
  return await res.json();
}

async function renderOrders() {
  const container = document.getElementById('ordersList');
  if (!container) return;
  try {
    const orders = await getOrders();
    if (orders.length === 0) {
      container.innerHTML = '<p>No orders yet.</p>';
    } else {
      container.innerHTML = orders.map(o => `
        <div class="card">
          <h3>Order #${o.id}</h3>
          <p>Date: ${new Date(o.created_at).toLocaleString()}</p>
          <p>Total: $${o.total_amount}</p>
          <p>Status: ${o.status}</p>
          ${o.mpesa_receipt ? `<p>Receipt: ${o.mpesa_receipt}</p>` : ''}
        </div>
      `).join('');
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p>Error loading orders.</p>';
  }
}

// ========== ACCOUNT ==========
async function updateProfile(phone) {
  const res = await fetch('/api/auth/update', {
    method: 'PUT',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone })
  });
  if (!res.ok) throw new Error('Update failed');
  return await res.json();
}

// ========== ADMIN DASHBOARD ==========
let currentUserId = null, currentOrderId = null;

async function adminLoadUsers() {
  const res = await fetch('/api/admin/users', { headers: authHeader() });
  const users = await res.json();
  const tbody = document.querySelector('#usersTable tbody');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.id}</td><td>${u.username}</td><td>${u.email}</td><td>${u.phone || '-'}</td>
      <td>${u.role}</td><td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>
        <button class="btn-sm edit-btn" data-id="${u.id}" data-role="${u.role}">Change Role</button>
        <button class="btn-sm delete-btn" data-id="${u.id}">Delete</button>
      </td>
    </tr>
  `).join('');
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentUserId = btn.dataset.id;
      document.getElementById('roleSelect').value = btn.dataset.role;
      document.getElementById('roleModal').style.display = 'flex';
    });
  });
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete user?')) {
        await fetch(`/api/admin/users/${btn.dataset.id}`, { method: 'DELETE', headers: authHeader() });
        adminLoadUsers();
      }
    });
  });
}

async function adminLoadOrders() {
  const res = await fetch('/api/admin/orders', { headers: authHeader() });
  const orders = await res.json();
  const tbody = document.querySelector('#ordersTable tbody');
  if (!tbody) return;
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>${o.id}</td><td>${o.username}</td><td>$${o.total_amount}</td>
      <td>${o.status}</td><td>${new Date(o.created_at).toLocaleString()}</td>
      <td>${o.mpesa_receipt || '-'}</td>
      <td><button class="btn-sm edit-btn" data-id="${o.id}" data-status="${o.status}">Change Status</button></td>
    </tr>
  `).join('');
  document.querySelectorAll('#ordersTable .edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentOrderId = btn.dataset.id;
      document.getElementById('orderStatusSelect').value = btn.dataset.status;
      document.getElementById('orderModal').style.display = 'flex';
    });
  });
}

async function adminLoadProducts() {
  const res = await fetch('/api/vendor/products', { headers: authHeader() });
  const products = await res.json();
  const tbody = document.querySelector('#productsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.id}</td><td>${p.name}</td><td>$${p.price}</td><td>${p.stock}</td>
      <td>${p.description || ''}</td>
      <td><button class="btn-sm delete-btn" data-id="${p.id}">Delete</button></td>
    </tr>
  `).join('');
  document.querySelectorAll('#productsTable .delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete product?')) {
        await fetch(`/api/vendor/products/${btn.dataset.id}`, { method: 'DELETE', headers: authHeader() });
        adminLoadProducts();
      }
    });
  });
}

// ========== VENDOR DASHBOARD ==========
async function vendorLoadProducts() {
  const res = await fetch('/api/vendor/products', { headers: authHeader() });
  const products = await res.json();
  const tbody = document.querySelector('#productsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${p.id}</td><td>${p.name}</td><td>$${p.price}</td><td>${p.stock}</td>
      <td>${p.description || ''}</td>
      <td>${p.image_url ? p.image_url.substring(0,30) : ''}</td>
      <td>
        <button class="btn-sm edit" data-id="${p.id}">Edit</button>
        <button class="btn-sm delete" data-id="${p.id}">Delete</button>
      </td>
    </tr>
  `).join('');
  document.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', () => vendorEditProduct(btn.dataset.id));
  });
  document.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Delete product?')) {
        await fetch(`/api/vendor/products/${btn.dataset.id}`, { method: 'DELETE', headers: authHeader() });
        vendorLoadProducts();
      }
    });
  });
}

async function vendorEditProduct(id) {
  const res = await fetch('/api/vendor/products', { headers: authHeader() });
  const products = await res.json();
  const product = products.find(p => p.id == id);
  const name = prompt('Name', product.name);
  const price = parseFloat(prompt('Price', product.price));
  const stock = parseInt(prompt('Stock', product.stock));
  const desc = prompt('Description', product.description);
  const img = prompt('Image URL', product.image_url);
  if (name && !isNaN(price) && !isNaN(stock)) {
    await fetch(`/api/vendor/products/${id}`, {
      method: 'PUT',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, stock, description: desc, image_url: img })
    });
    vendorLoadProducts();
  }
}

async function vendorAddProduct() {
  const name = prompt('Product name');
  const price = parseFloat(prompt('Price'));
  const stock = parseInt(prompt('Stock'));
  const desc = prompt('Description');
  const img = prompt('Image URL (optional)');
  if (name && !isNaN(price) && !isNaN(stock)) {
    await fetch('/api/vendor/products', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price, stock, description: desc, image_url: img })
    });
    vendorLoadProducts();
  }
}

// ========== PAGE INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', (e) => { e.preventDefault(); logout(); });

  const path = window.location.pathname;

  // Home page
  if (path === '/home.html' || path === '/') {
    // nothing special
  }

  // Login page
  else if (path === '/login.html') {
    const form = document.getElementById('loginForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        try {
          await login(username, password);
          window.location.href = '/dashboard.html';
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  // Signup page
  else if (path === '/signup.html') {
    const form = document.getElementById('signupForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const phone = document.getElementById('phone').value;
        try {
          await signup(username, email, password, phone);
          window.location.href = '/dashboard.html';
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  // Dashboard page
  else if (path === '/dashboard.html') {
    if (!requireAuth()) return;
    const userSpan = document.getElementById('usernameDisplay');
    if (userSpan) userSpan.textContent = localStorage.getItem('username') || 'User';
  }

  // Products page
  else if (path === '/products.html') {
    window.addToCartAndRefresh = addToCartAndRefresh;
    loadProducts().then(products => renderProducts('productsContainer', products));
  }

  // Cart page
  else if (path === '/cart.html') {
    window.removeCartItem = removeCartItem;
    window.proceedCheckout = proceedCheckout;
    renderCart();
  }

  // Orders page
  else if (path === '/orders.html') {
    if (!requireAuth()) return;
    renderOrders();
  }

  // Account page
  else if (path === '/account.html') {
    if (!requireAuth()) return;
    const phoneInput = document.getElementById('phone');
    const saveBtn = document.getElementById('saveAccountBtn');
    if (saveBtn && phoneInput) {
      getCurrentUser().then(user => {
        if (user && user.phone) phoneInput.value = user.phone;
      });
      saveBtn.addEventListener('click', async () => {
        try {
          await updateProfile(phoneInput.value);
          alert('Profile updated');
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  // Payment page
  else if (path === '/payment.html') {
    const payBtn = document.getElementById('payNowBtn');
    if (payBtn) payBtn.addEventListener('click', proceedCheckout);
  }

  // Admin page
  else if (path === '/admin.html') {
    if (!requireAuth()) window.location.href = '/login.html';
    getCurrentUser().then(user => {
      if (user.role !== 'admin') window.location.href = '/dashboard.html';
    });
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tab).classList.add('active');
        if (tab === 'users') adminLoadUsers();
        if (tab === 'orders') adminLoadOrders();
        if (tab === 'products') adminLoadProducts();
      });
    });
    // Modals
    const saveRoleBtn = document.getElementById('saveRoleBtn');
    const closeRole = document.getElementById('closeRoleModal');
    const saveOrderBtn = document.getElementById('saveOrderStatusBtn');
    const closeOrder = document.getElementById('closeOrderModal');
    if (saveRoleBtn) {
      saveRoleBtn.addEventListener('click', async () => {
        const newRole = document.getElementById('roleSelect').value;
        await fetch(`/api/admin/users/${currentUserId}/role`, {
          method: 'PUT',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: newRole })
        });
        document.getElementById('roleModal').style.display = 'none';
        adminLoadUsers();
      });
    }
    if (closeRole) closeRole.addEventListener('click', () => document.getElementById('roleModal').style.display = 'none');
    if (saveOrderBtn) {
      saveOrderBtn.addEventListener('click', async () => {
        const newStatus = document.getElementById('orderStatusSelect').value;
        await fetch(`/api/admin/orders/${currentOrderId}/status`, {
          method: 'PUT',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        document.getElementById('orderModal').style.display = 'none';
        adminLoadOrders();
      });
    }
    if (closeOrder) closeOrder.addEventListener('click', () => document.getElementById('orderModal').style.display = 'none');
    window.onclick = (e) => { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; };
    // Load initial tab
    adminLoadUsers();
    const addProductBtn = document.getElementById('addProductBtn');
    if (addProductBtn) addProductBtn.addEventListener('click', async () => {
      const name = prompt('Product name');
      const price = parseFloat(prompt('Price'));
      const stock = parseInt(prompt('Stock'));
      const desc = prompt('Description');
      if (name && price && stock) {
        await fetch('/api/vendor/products', {
          method: 'POST',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, price, stock, description: desc })
        });
        adminLoadProducts();
      }
    });
  }

  // Vendor page
  else if (path === '/vendor.html') {
    if (!requireAuth()) window.location.href = '/login.html';
    getCurrentUser().then(user => {
      if (!['vendor','admin'].includes(user.role)) window.location.href = '/dashboard.html';
    });
    vendorLoadProducts();
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) addBtn.addEventListener('click', vendorAddProduct);
  }
});

// Expose globals for inline onclick (still needed for add to cart buttons)
window.addToCartAndRefresh = addToCartAndRefresh;
window.removeCartItem = removeCartItem;
window.proceedCheckout = proceedCheckout;
window.renderCart = renderCart;
window.logout = logout;
window.isLoggedIn = isLoggedIn;
window.requireAuth = requireAuth;
window.getCurrentUser = getCurrentUser;
window.getOrders = getOrders;
window.loadProducts = loadProducts;
