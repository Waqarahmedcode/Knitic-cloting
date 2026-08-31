# KINETIC ATLAS — Premium Static E-commerce Prototype

A premium, responsive, static fashion storefront built around the supplied Kinetic Atlas visual direction.

## Included
- Premium light sage / ivory design system
- Responsive home, shop, product, account and checkout pages
- Cinematic layered hero: thread → fabric → garment weave, 5-layer depth parallax
- Interactive kinetic thread canvas (inner pages)
- Glass/refraction-style overlays and editorial art direction
- Product filtering, search modal, wishlist state and persistent localStorage cart
- Quantity controls, cart drawer, subtotal and demo checkout
- Product structured data (JSON-LD), Organization/WebSite schemas
- robots.txt, sitemap.xml and PWA manifest starter
- Supplied image assets renamed and organized under `assets/images/`

## Run locally

```bash
python3 -m http.server 8000     # from this folder
# then open http://localhost:8000/
```

Opening `index.html` straight off disk works too, but a local server matches
production behaviour (relative asset paths, image decoding, caching). To check
the hero on a phone, serve it on your LAN and open the same port from the
device — the parallax picks up device orientation there, which desktop cannot
demonstrate.

## Production connections still required
This package is a front-end implementation. Real commerce requires a secure commerce/payment back end. Recommended options: Shopify Storefront + Checkout, WooCommerce REST/Store API, Medusa, Saleor, or a custom Node/Next back end. Payments should use Stripe/Shopify/PayPal hosted PCI-compliant components. Authentication, inventory, tax, shipping quotes, coupons, order persistence, email, analytics consent and fulfilment APIs must be connected to production services.

## The hero (home page)

The landing hero is its own self-contained system. Nothing outside `.hero`
depends on it, and no other page loads it.

| File | Role |
| --- | --- |
| `assets/css/hero.css` | Every hero style: layout, depth layers, entrance states, breakpoints, reduced-motion |
| `assets/js/hero.js` | One `requestAnimationFrame` loop: pointer/gyroscope parallax, scroll scrub, weave canvas, reveal observer |
| `assets/images/hero-garment.{webp,png}` | Alpha-matted product (layer 3) |
| `assets/images/hero-garment-shadow.{webp,png}` | Its contact shadow (layer 2) |
| `tools/make-hero-cutout.py` | Regenerates both from `assets/images/product-olive-crew.jpg` |

Depth layers, back to front: atmosphere (0.10) → contact shadow (0.24) →
weave canvas (0.40) → garment (0.42) → fibre motes (0.70). Depth, tilt, scroll
travel and scroll scale are declared per layer in the markup as
`data-depth` / `data-tilt` / `data-rise` / `data-zoom`, and hero.js reads them —
so the whole effect is retuned from `index.html`, without touching the engine.

Performance rules the hero keeps to:
- only `transform` and `opacity` are animated, so nothing leaves the compositor
- one shared rAF loop, which parks itself as soon as every value has settled
- the weave canvas draws at ~30fps, then retires and releases its backing store
- `prefers-reduced-motion` skips the canvas and the entrance entirely

### Regenerating the product cutout

```bash
pip install pillow numpy
python3 tools/make-hero-cutout.py
```

Keying thresholds live at the top of the script. It only ever reads a photo
that is already in `assets/images/`.

## Main files
- `index.html` — flagship landing page
- `shop.html` — catalog / filters
- `product.html?id=club-crew` — dynamic product detail template
- `checkout.html` — secure checkout UI prototype
- `account.html` — customer auth UI prototype
- `assets/js/data.js` — product data
- `assets/js/app.js` — cart, search, wishlist, ambient thread canvas, interactions
- `assets/js/hero.js` — home-page hero engine (depth, weave, scroll)
- `assets/css/hero.css` — home-page hero design system
- `assets/css/styles.css` — full responsive design system

## Product IDs
`club-crew`, `retro-crew`, `movement-crew`, `atlas-retro`, `midnight-oversized`, `fabric-edition`
