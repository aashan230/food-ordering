const API = '/api';
let cart = {};
let menu = [];

function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadMenu() {
    try {
        const res = await fetch(`${API}/menu`);
        if (!res.ok) throw new Error('Failed to load menu');
        menu = await res.json();
        renderMenu();
    } catch (err) {
        document.getElementById('menu-grid').innerHTML = `<p class="error">Could not load menu: ${escape(err.message)}</p>`;
    }
}

function renderMenu() {
    const grid = document.getElementById('menu-grid');
    if (menu.length === 0) { grid.innerHTML = '<p>No menu items available.</p>'; return; }
    grid.innerHTML = menu.map(item => `
        <div class="menu-card">
            <h3>${escape(item.name)}</h3>
            <p class="desc">${escape(item.description || '')}</p>
            <div class="price">Rs. ${item.price}</div>
            <button data-id="${item.id}">+ Add to Cart</button>
        </div>
    `).join('');
    grid.querySelectorAll('button[data-id]').forEach(btn => {
        btn.addEventListener('click', () => addToCart(parseInt(btn.dataset.id)));
    });
}

function addToCart(id) {
    const item = menu.find(m => m.id === id);
    if (!item) return;
    if (!cart[id]) cart[id] = { name: item.name, price: item.price, quantity: 0 };
    cart[id].quantity++;
    renderCart();
}

function changeQty(id, delta) {
    if (!cart[id]) return;
    cart[id].quantity += delta;
    if (cart[id].quantity <= 0) delete cart[id];
    renderCart();
}

function renderCart() {
    const ids = Object.keys(cart);
    const emptyEl = document.getElementById('cart-empty');
    const cartEl = document.getElementById('cart');
    if (ids.length === 0) { emptyEl.style.display = 'block'; cartEl.classList.add('hidden'); return; }
    emptyEl.style.display = 'none';
    cartEl.classList.remove('hidden');
    const list = document.getElementById('cart-items');
    let total = 0;
    list.innerHTML = ids.map(id => {
        const c = cart[id];
        const subtotal = c.price * c.quantity;
        total += subtotal;
        return `<li><span>${escape(c.name)} — Rs. ${c.price}</span>
            <div class="qty-controls">
                <button data-id="${id}" data-delta="-1">−</button>
                <span>${c.quantity}</span>
                <button data-id="${id}" data-delta="1">+</button>
                <strong style="margin-left:12px;">Rs. ${subtotal}</strong>
            </div></li>`;
    }).join('');
    document.getElementById('cart-total-price').textContent = `Rs. ${total}`;
    list.querySelectorAll('button[data-delta]').forEach(btn => {
        btn.addEventListener('click', () => changeQty(parseInt(btn.dataset.id), parseInt(btn.dataset.delta)));
    });
}

async function placeOrder() {
    const name = document.getElementById('customer-name').value.trim();
    const resultEl = document.getElementById('order-result');
    resultEl.textContent = ''; resultEl.className = 'order-result';
    if (!name) { resultEl.textContent = 'Please enter your name.'; resultEl.classList.add('error'); return; }
    if (Object.keys(cart).length === 0) { resultEl.textContent = 'Your cart is empty.'; resultEl.classList.add('error'); return; }
    const items = Object.entries(cart).map(([id, c]) => ({ menu_item_id: parseInt(id), quantity: c.quantity }));
    try {
        const res = await fetch(`${API}/orders`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ customer_name: name, items }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Order failed');
        resultEl.textContent = `✓ Order #${data.order_id} placed! Total: Rs. ${data.total_price}. Status: ${data.delivery_status}.`;
        resultEl.classList.add('success');
        cart = {}; renderCart();
        document.getElementById('customer-name').value = '';
    } catch (err) { resultEl.textContent = `✗ ${err.message}`; resultEl.classList.add('error'); }
}

async function trackOrder() {
    const id = document.getElementById('track-input').value.trim();
    const resultEl = document.getElementById('track-result');
    resultEl.classList.remove('visible'); resultEl.innerHTML = '';
    if (!id) return;
    try {
        const res = await fetch(`${API}/orders/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lookup failed');
        const statusClass = 'status-' + data.delivery_status.toLowerCase().replace(/\s+/g, '-');
        resultEl.innerHTML = `
            <h3>Order #${data.id}</h3>
            <div class="row"><span>Customer</span><span>${escape(data.customer_name)}</span></div>
            <div class="row"><span>Placed at</span><span>${escape(data.created_at || '-')}</span></div>
            <div class="row"><span>Status</span><span class="status-badge ${statusClass}">${escape(data.delivery_status)}</span></div>
            <div class="row"><span>Total</span><strong>Rs. ${data.total_price}</strong></div>
            <ul class="track-items">${data.items.map(it => `<li><span>${it.quantity}× ${escape(it.name)}</span><span>Rs. ${it.subtotal}</span></li>`).join('')}</ul>`;
        resultEl.classList.add('visible');
    } catch (err) { resultEl.innerHTML = `<p class="error">${escape(err.message)}</p>`; resultEl.classList.add('visible'); }
}

document.getElementById('place-order-btn').addEventListener('click', placeOrder);
document.getElementById('track-btn').addEventListener('click', trackOrder);
document.getElementById('track-input').addEventListener('keydown', e => { if (e.key === 'Enter') trackOrder(); });
loadMenu();
