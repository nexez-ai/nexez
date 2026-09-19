import { shopifyApiKey, shopifyConfigured } from '../../lib/server/shopify'

export const dynamic = 'force-dynamic'

function shell(apiKey: string) {
  const safeApiKey = apiKey.replace(/[^A-Za-z0-9_-]/g, '')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="shopify-api-key" content="${safeApiKey}">
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <title>Nexez Agent-Ready</title>
  <style>
    :root { color-scheme: light; --ink:#202223; --muted:#616a75; --line:#dfe3e8; --surface:#fff; --soft:#f6f6f7; --accent:#008060; --accent-hover:#006e52; --danger:#b42318; --warning:#8a6116; }
    * { box-sizing:border-box; }
    body { margin:0; background:#f1f2f4; color:var(--ink); font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing:0; }
    button,a { font:inherit; }
    button:focus-visible,a:focus-visible { outline:2px solid #005bd3; outline-offset:2px; }
    .wrap { width:min(100%,980px); margin:0 auto; padding:32px 24px 56px; }
    .head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:24px; }
    .brand { margin:0 0 4px; font-size:22px; line-height:1.25; font-weight:650; }
    .sub { margin:0; color:var(--muted); }
    .status { display:inline-flex; align-items:center; min-height:28px; padding:4px 10px; border:1px solid #b7e4d7; border-radius:999px; background:#eaf7f2; color:#005c45; font-size:12px; font-weight:650; white-space:nowrap; }
    .panel { border:1px solid var(--line); border-radius:8px; background:var(--surface); box-shadow:0 1px 2px rgba(0,0,0,.05); }
    .hero { padding:24px; }
    .hero h1 { margin:0 0 8px; font-size:20px; line-height:1.35; font-weight:650; }
    .hero p { max-width:680px; margin:0; color:var(--muted); }
    .actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
    .btn { display:inline-flex; min-height:40px; align-items:center; justify-content:center; gap:8px; border:1px solid #babfc3; border-radius:7px; background:#fff; color:var(--ink); padding:8px 14px; text-decoration:none; font-weight:600; cursor:pointer; transition:background .15s,border-color .15s,transform .15s; }
    .btn:hover { background:#f6f6f7; border-color:#8c9196; }
    .btn:active { transform:translateY(1px); }
    .btn.primary { border-color:var(--accent); background:var(--accent); color:#fff; }
    .btn.primary:hover { border-color:var(--accent-hover); background:var(--accent-hover); }
    .btn:disabled { cursor:not-allowed; opacity:.58; transform:none; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); margin-top:20px; border-top:1px solid var(--line); }
    .step { min-width:0; padding:20px 22px; border-right:1px solid var(--line); }
    .step:last-child { border-right:0; }
    .step-label { margin:0 0 6px; color:var(--muted); font-size:12px; font-weight:650; text-transform:uppercase; }
    .step h2 { margin:0 0 7px; font-size:15px; font-weight:650; }
    .step p { margin:0; color:var(--muted); overflow-wrap:anywhere; }
    .step .actions { margin-top:16px; }
    .notice { margin-top:16px; padding:12px 14px; border:1px solid var(--line); border-radius:7px; background:var(--soft); color:var(--muted); }
    .notice.error { border-color:#f3b6b2; background:#fff0ef; color:var(--danger); }
    .notice.warning { border-color:#e8cf91; background:#fff8e6; color:var(--warning); }
    .meta { margin-top:20px; display:flex; flex-wrap:wrap; gap:10px 20px; color:var(--muted); font-size:12px; }
    .meta a { color:inherit; }
    .catalog { padding:0 24px 24px; display:grid; gap:16px; }
    .product { border:1px solid var(--line); border-radius:8px; padding:20px; }
    .product h2 { margin:0 0 8px; font-size:17px; }
    .product p { margin:8px 0; }
    .product ul { padding-left:20px; }
    .journey { padding-left:20px; color:var(--muted); }
    details { margin-top:16px; }
    summary { cursor:pointer; font-weight:600; }
    .skeleton { height:14px; margin:10px 0; border-radius:4px; background:#eceff1; animation:pulse 1.4s ease-in-out infinite; }
    .skeleton.short { width:48%; }
    @keyframes pulse { 50% { opacity:.45; } }
    @media (max-width:720px) { .wrap{padding:22px 16px 40px}.head{align-items:flex-start}.grid{grid-template-columns:1fr}.step{border-right:0;border-bottom:1px solid var(--line)}.step:last-child{border-bottom:0}.actions .btn{width:100%} }
    @media (prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important; } }
  </style>
</head>
<body>
  <main class="wrap">
    <header class="head">
      <div><p class="brand">Nexez Agent-Ready</p><p class="sub" id="shop-label">Opening your store connection</p></div>
      <span class="status" id="app-status">Checking</span>
    </header>
    <section class="panel" aria-live="polite" id="app">
      <div class="hero"><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    </section>
    <footer class="meta"><span>Catalog access is read-only. Storefront agent links become public after your Online Store is unlocked.</span><a href="https://nexez.ai/privacy" target="_blank" rel="noreferrer">Privacy</a><a href="https://nexez.ai/support" target="_blank" rel="noreferrer">Support</a></footer>
  </main>
  <script>
    (() => {
      const app = document.getElementById('app');
      const appStatus = document.getElementById('app-status');
      const shopLabel = document.getElementById('shop-label');
      let context = null;

      const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
      const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Not synced yet';
      const openExternal = (url) => window.open(url, '_blank', 'noopener,noreferrer');
      const openTopLevel = (url) => window.open(url, '_top');

      function renderError(message) {
        appStatus.textContent = 'Needs attention';
        appStatus.style.background = '#fff0ef';
        appStatus.style.borderColor = '#f3b6b2';
        appStatus.style.color = '#8e1f17';
        app.innerHTML = '<div class="hero"><h1>We could not open this connection</h1><p>'+escapeHtml(message)+'</p><div class="actions"><button class="btn primary" id="retry">Try again</button></div></div>';
        document.getElementById('retry').addEventListener('click', load);
      }

      function renderLink(data) {
        appStatus.textContent = 'Account link needed';
        shopLabel.textContent = data.shop;
        app.innerHTML = '<div class="hero"><h1>Connect this store to Nexez</h1><p>Continue to choose the Nexez listing that should receive this Shopify catalog. You will leave Shopify briefly to complete the secure account link.</p><div class="actions"><button class="btn primary" id="connect">Continue to Nexez</button></div><div class="notice">Nexez reads your active products and publishes agent-readable discovery links. Checkout stays on your Shopify store.</div></div>';
        document.getElementById('connect').addEventListener('click', () => openTopLevel(data.connectUrl));
      }

      function renderLinked(data) {
        const listingName = data.listing?.name || data.listing?.slug || 'Connected listing';
        const sync = data.sync || {};
        const channelError = data.channelError || '';
        const attentionMessage = sync.error || channelError;
        appStatus.textContent = attentionMessage ? 'Needs attention' : sync.pending ? 'Sync queued' : sync.lastSyncedAt ? 'Connected' : 'Setup incomplete';
        shopLabel.textContent = data.shop;
        const billingLabel = data.billing?.planHandle ? 'Plan: '+data.billing.planHandle : data.billing?.status === 'free' ? 'Free plan' : 'Choose or verify a plan';
        const channelLabel = data.channel?.id ? 'Shopify confirmed this Nexez channel for '+(data.channel.accountName || listingName)+'. Shopify labels the destination Nexez AI discovery in product publishing controls.' : 'Sales channel setup needs attention.';
        const productAdminUrl = 'https://admin.shopify.com/store/'+encodeURIComponent(String(data.shop || '').split('.')[0])+'/products';
        app.innerHTML = '<div class="hero"><h1>'+escapeHtml(listingName)+'</h1><p>Your Shopify catalog is linked to Nexez. Keep products current, preview the catalog, and enable discovery from your storefront.</p>'+(attentionMessage?'<div class="notice warning" id="sync-notice">'+escapeHtml(attentionMessage)+'</div>':'<div class="notice" id="sync-notice">Last catalog sync: '+escapeHtml(formatDate(sync.lastSyncedAt))+'</div>')+'<div class="actions"><button class="btn" id="change-listing">Change listing</button></div></div><div class="grid"><section class="step"><p class="step-label">Sales channel</p><h2>Channel connection</h2><p>'+escapeHtml(channelLabel)+'</p><div class="actions"><button class="btn" id="products">Open products</button></div></section><section class="step"><p class="step-label">Catalog</p><h2>Keep offers current</h2><p>Only active products published to this Nexez channel are imported.</p><div class="actions"><button class="btn" id="sync">Sync now</button></div></section><section class="step"><p class="step-label">Storefront</p><h2>Enable discovery links</h2><p>Activate the theme app embed so agents can find the manifest from your storefront.</p><div class="actions"><button class="btn" id="theme">Open theme editor</button></div></section><section class="step"><p class="step-label">Product preview</p><h2>Review your synced catalog</h2><p>See product names, prices, variants, and availability. Product links open your Shopify storefront, where customers add to cart and check out.</p><div class="actions"><button class="btn primary" id="preview">Preview catalog</button></div><details><summary>Agent data for developers</summary><p>The agent endpoint returns machine-readable JSON. A browser may show a pretty-print view. This is data for AI agents; the catalog preview above is for people.</p><p>'+escapeHtml(data.storefrontArtifactUrl)+'</p><div class="actions"><a class="btn" href="'+escapeHtml(data.storefrontArtifactUrl)+'" target="_blank" rel="noopener noreferrer">View raw agent JSON</a></div></details></section><section class="step"><p class="step-label">Plan</p><h2>Shopify App Pricing</h2><p>'+escapeHtml(billingLabel)+'. Charges appear on your Shopify invoice.</p><div class="actions"><button class="btn" id="billing">Manage plan in Shopify</button></div></section></div>';
        document.getElementById('products').addEventListener('click', () => openExternal(productAdminUrl));
        document.getElementById('theme').addEventListener('click', () => openExternal(data.themeEditorUrl));
        document.getElementById('preview').addEventListener('click', () => renderCatalog(data));
        document.getElementById('sync').addEventListener('click', syncNow);
        document.getElementById('change-listing').addEventListener('click', changeListing);
        document.getElementById('billing').addEventListener('click', () => openTopLevel(data.billing.pricingUrl));
      }

      function renderCatalog(data) {
        const products = data.catalog?.products || [];
        const availability = { available:'Available', limited:'Some variants unavailable', sold_out:'Sold out' };
        app.innerHTML = '<div class="hero"><h1 id="catalog-title" tabindex="-1">Catalog preview</h1><p>'+escapeHtml(data.listing?.name || data.listing?.slug)+' · '+products.length+' synced products from '+escapeHtml(data.shop)+'</p><p>Last catalog sync: '+escapeHtml(formatDate(data.sync?.lastSyncedAt))+'</p><div class="notice"><strong>How customers buy</strong><ol class="journey"><li>An AI agent reads the products you publish to Nexez AI discovery.</li><li>The customer follows a product link to this Shopify store.</li><li>The customer chooses a variant, adds it to the cart, and completes Shopify checkout. Shopify handles payment and the order.</li></ol>Each connected store keeps its own catalog and checkout. Nexez does not combine carts between stores or collect payment for these products.</div>'+(data.catalog?.published?'':'<div class="notice warning">This Nexez listing is not published. Publish it in Nexez before customers or agents can access its catalog.</div>')+'<div class="actions"><button class="btn" id="back">Back to app</button></div></div><div class="catalog">'+(products.length?products.map((product)=>'<article class="product"><h2>'+escapeHtml(product.name)+'</h2><p><strong>'+escapeHtml(product.price)+'</strong> · '+escapeHtml(availability[product.availability] || 'Check availability on Shopify')+'</p><p>'+escapeHtml(product.description)+'</p>'+(product.variants?.length?'<ul>'+product.variants.map((variant)=>'<li>'+escapeHtml(variant.name)+': '+escapeHtml(variant.price)+'</li>').join('')+'</ul>':'')+(product.url?'<a class="btn" href="'+escapeHtml(product.url)+'" target="_blank" rel="noopener noreferrer">View product on Shopify</a>':'<p>Product link unavailable. Sync the catalog again from the app home.</p>')+'</article>').join(''):'<div class="notice">No products have been synced for this connection yet. Publish active products to Nexez AI discovery in Shopify, then return to the app and click Sync now.</div>')+'</div>';
        document.getElementById('back').addEventListener('click', () => {
          renderLinked(data);
          document.getElementById('preview').focus();
        });
        document.getElementById('catalog-title').focus();
      }

      async function changeListing() {
        const button = document.getElementById('change-listing');
        const notice = document.getElementById('sync-notice');
        button.disabled = true;
        button.textContent = 'Opening Nexez';
        try {
          const response = await fetch('/api/shopify/session/relink', { method:'POST' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.connectUrl) throw new Error(data.error || 'The listing picker could not open.');
          openTopLevel(data.connectUrl);
        } catch (error) {
          notice.className = 'notice error';
          notice.textContent = error instanceof Error ? error.message : 'The listing picker could not open.';
          button.disabled = false;
          button.textContent = 'Change listing';
        }
      }

      async function syncNow() {
        const button = document.getElementById('sync');
        const notice = document.getElementById('sync-notice');
        button.disabled = true;
        button.textContent = 'Syncing';
        try {
          const response = await fetch('/api/shopify/session/sync', { method:'POST' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Catalog sync could not finish.');
          notice.className = 'notice';
          notice.textContent = 'Catalog synced. '+Number(data.imported || 0)+' active products imported.';
          button.textContent = 'Synced';
          setTimeout(load, 900);
        } catch (error) {
          notice.className = 'notice error';
          notice.textContent = error instanceof Error ? error.message : 'Catalog sync could not finish.';
          button.disabled = false;
          button.textContent = 'Try sync again';
        }
      }

      async function load() {
        appStatus.textContent = 'Checking';
        try {
          const response = await fetch('/api/shopify/session'+window.location.search, { method:'POST' });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Shopify could not authenticate this app session.');
          context = data;
          if (data.state === 'linked') renderLinked(data); else renderLink(data);
        } catch (error) {
          renderError(error instanceof Error ? error.message : 'Try reopening the app from Shopify admin.');
        }
      }

      load();
    })();
  </script>
</body>
</html>`
}

export async function GET() {
  if (!shopifyConfigured()) {
    return Response.json({ error: 'Shopify app is not configured.' }, { status: 404 })
  }
  return new Response(shell(shopifyApiKey()), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; style-src 'unsafe-inline'; connect-src 'self' https://*.shopify.com; img-src 'self' data:; frame-ancestors https://admin.shopify.com https://*.myshopify.com",
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    },
  })
}
