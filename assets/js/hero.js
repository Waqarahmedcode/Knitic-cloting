/* =========================================================================
   KINETIC ATLAS — HERO ENGINE
   Zero dependencies. Everything runs on ONE requestAnimationFrame loop and
   only ever writes `transform` / `opacity`, so nothing here can trigger a
   layout or a paint on the main document.

   Contents
     1. Input      pointer (desktop) + gyroscope/touch (mobile), damped
     2. Depth      per-layer parallax, driven by data-depth / data-tilt
     3. Scroll     one cached measurement, scrubbed with the same loop
     4. Weave      canvas: fibre → thread → fabric → garment silhouette
     5. Lifecycle  intro trigger, visibility gating, reveal observer

   The loop is only alive while the hero is on screen (IntersectionObserver)
   and parks itself once every damped value has settled, so an idle hero
   costs nothing on battery.
   ========================================================================= */
(function () {
  "use strict";

  var hero = document.querySelector("[data-hero]");
  if (!hero) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia("(pointer: coarse)").matches;

  var stage = hero.querySelector(".hero-art");
  var garment = hero.querySelector(".hero-garment img");
  var canvas = hero.querySelector(".hero-weave");
  var cue = hero.querySelector(".hero-cue");
  var copyLayers = [].slice.call(hero.querySelectorAll("[data-scroll-copy]"));
  var layers = [].slice.call(hero.querySelectorAll("[data-depth]")).map(function (el) {
    return {
      el: el,
      depth: parseFloat(el.dataset.depth) || 0,       // parallax strength
      tilt: parseFloat(el.dataset.tilt) || 0,         // 3D rotation strength
      rise: parseFloat(el.dataset.rise) || 0,         // scroll travel, px
      zoom: parseFloat(el.dataset.zoom) || 0          // scroll scale delta
    };
  });

  /* --------------------------------------------------------------- state -- */

  var px = 0, py = 0;          // damped pointer, -1..1
  var tx = 0, ty = 0;          // target pointer
  var prog = 0, progT = 0;     // damped / target scroll progress, 0..1
  var heroTop = 0, heroSpan = 1;
  var visible = true, running = false, settled = false;

  // Damping: low enough to feel weighty, high enough to never lag behind.
  var EASE = coarse ? 0.085 : 0.065;
  var MAX_SHIFT = 26;          // px of travel at depth 1.0
  var MAX_TILT = 6.5;          // deg at tilt 1.0 — deliberately understated

  /* --------------------------------------------------------------- input -- */

  function pointer(x, y) {
    var r = hero.getBoundingClientRect();
    tx = Math.max(-1, Math.min(1, (x - r.left) / r.width * 2 - 1));
    ty = Math.max(-1, Math.min(1, (y - r.top) / r.height * 2 - 1));
    wake();
  }

  if (!reduced) {
    if (!coarse) {
      hero.addEventListener("pointermove", function (e) { pointer(e.clientX, e.clientY); }, { passive: true });
      hero.addEventListener("pointerleave", function () { tx = ty = 0; wake(); }, { passive: true });
    } else {
      // Touch drag gives the same signal as a mouse without blocking scroll.
      hero.addEventListener("touchmove", function (e) {
        var t = e.touches[0];
        if (t) pointer(t.clientX, t.clientY);
      }, { passive: true });
      hero.addEventListener("touchend", function () { tx = ty = 0; wake(); }, { passive: true });
      initGyro();
    }
  }

  /* Device orientation, when the platform allows it. Readings are calibrated
     against the first sample so the hero is neutral at whatever angle the
     phone is already being held, and clamped hard to avoid seasickness. */
  function initGyro() {
    if (!("DeviceOrientationEvent" in window)) return;
    var base = null;

    function onTilt(e) {
      if (e.gamma == null || e.beta == null) return;
      if (!base) base = { g: e.gamma, b: e.beta };
      tx = Math.max(-1, Math.min(1, (e.gamma - base.g) / 22));
      ty = Math.max(-1, Math.min(1, (e.beta - base.b) / 26));
      wake();
    }

    var needsPermission = typeof DeviceOrientationEvent.requestPermission === "function";
    if (!needsPermission) {
      window.addEventListener("deviceorientation", onTilt, { passive: true });
      return;
    }
    // iOS: only grantable from a user gesture, so ask on the first tap.
    var ask = function () {
      document.removeEventListener("touchend", ask);
      DeviceOrientationEvent.requestPermission().then(function (r) {
        if (r === "granted") window.addEventListener("deviceorientation", onTilt, { passive: true });
      }).catch(function () { /* declined — touch parallax still applies */ });
    };
    document.addEventListener("touchend", ask, { once: true, passive: true });
  }

  /* -------------------------------------------------------------- scroll -- */

  function measure() {
    var r = hero.getBoundingClientRect();
    heroTop = r.top + window.scrollY;
    heroSpan = Math.max(1, r.height * 0.92);
    if (canvas) weave.resize();
  }

  function readScroll() {
    progT = Math.max(0, Math.min(1, (window.scrollY - heroTop) / heroSpan));
    wake();
  }

  window.addEventListener("scroll", readScroll, { passive: true });
  window.addEventListener("resize", function () { measure(); readScroll(); }, { passive: true });

  /* --------------------------------------------------------------- frame -- */

  function render() {
    // Interpolate every driver once per frame.
    px += (tx - px) * EASE;
    py += (ty - py) * EASE;
    prog += (progT - prog) * 0.12;

    var p = prog;
    // The scroll cue is the only thing that reads progress outside the layer
    // list; writing its opacity directly avoids invalidating the hero subtree
    // with a custom property on every single frame.
    if (cue) cue.style.opacity = Math.max(0, 1 - p * 3).toFixed(3);

    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var x = px * MAX_SHIFT * L.depth;
      var y = py * MAX_SHIFT * L.depth * 0.72 - p * L.rise;
      var t = "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0)";
      if (L.tilt) {
        t += " rotateY(" + (px * MAX_TILT * L.tilt).toFixed(3) + "deg)" +
             " rotateX(" + (-py * MAX_TILT * 0.8 * L.tilt).toFixed(3) + "deg)";
      }
      if (L.zoom) t += " scale(" + (1 + p * L.zoom).toFixed(4) + ")";
      L.el.style.transform = t;
    }

    // Typography leaves a little faster than the product. Only the headline
    // block fades — the CTA and the spec strip keep full contrast for as long
    // as they are on screen, so the storytelling never costs legibility.
    for (var c = 0; c < copyLayers.length; c++) {
      var el = copyLayers[c];
      el.style.transform = "translate3d(0," + (-p * 58).toFixed(2) + "px,0)";
      if (el.dataset.scrollCopy === "fade") el.style.opacity = Math.max(0, 1 - p * 1.25).toFixed(3);
    }

    if (canvas) weave.frame(p);

    // Park the loop when nothing is moving any more.
    settled = Math.abs(tx - px) < 0.0015 && Math.abs(ty - py) < 0.0015 &&
              Math.abs(progT - prog) < 0.0008 && (!canvas || weave.idleQuiet());
    if (!visible || (settled && !weave.busy())) { running = false; return; }
    requestAnimationFrame(render);
  }

  function wake() {
    if (running || !visible) return;
    running = true;
    requestAnimationFrame(render);
  }

  /* ---------------------------------------------------------------- weave -- */
  /* fibre → thread → fabric → garment, on a canvas sized to the art stage.

     Timeline (seconds from intro):
       0.00-0.55  FIBRE   loose filaments drift in and are drawn to a spine
       0.35-1.00  THREAD  filaments braid into one travelling thread
       0.70-1.70  FABRIC  the thread unrolls into a warp/weft weave
       0.70-1.90  FORM    the weave contracts into the garment's silhouette
       1.90+      IDLE    weave dissolves back into a few drifting fibres
     The real photograph fades up underneath during FORM, so the garment
     resolves out of the woven mesh instead of simply appearing.            */

  var weave = (function () {
    if (!canvas) return { frame: noop, resize: noop, start: noop, busy: no, idleQuiet: yes };

    var ctx = canvas.getContext("2d", { alpha: true });
    var dpr = 1, W = 0, H = 0, t0 = 0, lastDraw = 0, started = false, done = false;
    var mask = null, maskBox = null, threadGrad = null, bodyGrad = null;
    var FIBRES = coarse ? 9 : 16;
    var fib = [];

    for (var i = 0; i < FIBRES; i++) {
      var u0 = Math.random() * 0.5;
      fib.push({
        // Three incommensurate frequencies per fibre. One sine reads as a wave;
        // layered octaves at these ratios read as a filament with real curl.
        f1: 3.2 + Math.random() * 2.4, p1: Math.random() * 6.28,
        f2: 8.6 + Math.random() * 4.1, p2: Math.random() * 6.28,
        f3: 17.4 + Math.random() * 6.0, p3: Math.random() * 6.28,
        r: 0.18 + Math.random() * 0.74,          // how far off the spine it sits
        s: 0.30 + Math.random() * 0.75,          // drift speed
        z: 0.32 + Math.random() * 0.68,          // depth: width, opacity, speed
        u0: u0, u1: u0 + 0.42 + Math.random() * 0.58   // fibres have ends
      });
    }
    fib.sort(function (a, b) { return a.z - b.z; });   // far fibres drawn first

    function noop() {} function no() { return false; } function yes() { return true; }

    function resize() {
      if (done || !stage) return;
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      /* The full-surface composite passes (silhouette mask, body fill) cost one
         operation per device pixel, so the backing store is kept modest: these
         are hairlines and soft washes, not type. */
      dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      if (w === W && h === H) return;
      W = w; H = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Thread colour: ink core warmed toward the brand gold as it weaves.
      threadGrad = ctx.createLinearGradient(0, 0, w, h);
      threadGrad.addColorStop(0, "rgba(70,94,84,.9)");
      threadGrad.addColorStop(0.5, "rgba(168,149,111,.95)");
      threadGrad.addColorStop(1, "rgba(70,94,84,.85)");
      bodyGrad = ctx.createLinearGradient(0, 0, 0, h);
      bodyGrad.addColorStop(0, "rgba(196,201,171,.9)");
      bodyGrad.addColorStop(1, "rgba(150,160,132,.9)");
      if (garment && garment.offsetWidth) {
        // Layout box (transform-free) so the mask lines up with the photo
        // regardless of the entrance scale currently applied to it.
        maskBox = { x: garment.offsetLeft, y: garment.offsetTop, w: garment.offsetWidth, h: garment.offsetHeight };
      }
    }

    function start() {
      if (started) return;
      started = true; t0 = performance.now();
      resize();
      // The matted garment doubles as the silhouette mask — already in cache.
      var m = new Image();
      m.decoding = "async";
      m.onload = function () { mask = prescale(m); };
      m.src = garment ? (garment.currentSrc || garment.src) : "";
    }

    /* The silhouette is drawn every frame while the weave contracts. Resampling
       the full-size bitmap each time is the most expensive call in the loop, so
       it is rasterised once at the size it is actually used. */
    function prescale(img) {
      if (!maskBox) return img;
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(maskBox.w * dpr));
      c.height = Math.max(1, Math.round(maskBox.h * dpr));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c;
    }

    function ease(x) { return 1 - Math.pow(1 - x, 3); }
    function span(now, a, b) { return Math.max(0, Math.min(1, (now - a) / (b - a))); }

    /* One fibre.

       Shape: three sine octaves at incommensurate frequencies, each drifting at
       its own rate, so the curl never repeats or reads as a waveform.
       Depth:  z drives width, opacity and drift speed together, and the fibres
       are depth-sorted, so near fibres pass in front of far ones.
       Body:   three strokes — a wide soft halo (the fuzz a spun fibre carries),
       the fibre itself, and a thin lit core along its middle, which is what
       makes it read as a round filament catching light rather than a line.
       Ends:   each fibre starts and stops somewhere, and tapers out at both
       ends via the halo alone, so nothing looks cut off. */
    function fibrePath(f, now, amp) {
      var span = Math.min(1, f.u1) - f.u0;
      var cy = H * (0.5 + Math.sin(f.p1 + now * f.s * 0.5) * 0.2 * f.r);
      ctx.beginPath();
      for (var i = 0; i <= 20; i++) {
        var u = i / 20;
        var t = f.u0 + u * span;
        // taper the excursion toward both ends so the fibre settles, not stops
        var env = Math.sin(u * Math.PI);
        var y = cy +
                Math.sin(t * f.f1 + f.p1 + now * f.s) * amp * 0.62 * env +
                Math.sin(t * f.f2 - f.p2 + now * f.s * 1.7) * amp * 0.26 * env +
                Math.sin(t * f.f3 + f.p3 - now * f.s * 2.6) * amp * 0.12 * env;
        i ? ctx.lineTo(t * W, y) : ctx.moveTo(t * W, y);
      }
    }

    function filament(f, now, amp, alpha, lit) {
      var w = 0.55 + f.z * 1.35;
      var a = alpha * (0.35 + f.z * 0.65);        // far fibres sit back
      if (a < 0.004) return;

      fibrePath(f, now, amp);
      ctx.lineWidth = w * 3.4;                    // halo / fibre fuzz
      ctx.globalAlpha = a * 0.16;
      ctx.stroke();
      ctx.lineWidth = w;                          // the fibre
      ctx.globalAlpha = a;
      ctx.stroke();
      if (lit && f.z > 0.55) {                    // specular core, near fibres only
        ctx.lineWidth = w * 0.4;
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = "rgba(247,244,232,.9)";
        ctx.stroke();
        ctx.strokeStyle = threadGrad;
      }
    }

    /* The mesh is laid out over the garment box, not the whole stage, so the
       cloth forms exactly where the product is about to appear - and so every
       full-surface fill stays confined to that rectangle. */
    function clothBox(k) {
      var bx = maskBox ? maskBox.x : W * 0.14, bw = maskBox ? maskBox.w : W * 0.72;
      var by = maskBox ? maskBox.y : H * 0.08, bh = maskBox ? maskBox.h : H * 0.84;
      var grow = 1 + (1 - k) * 0.5;                    // the weave settles inward
      return { x: bx - bw * (grow - 1) / 2, y: by - bh * (grow - 1) / 2, w: bw * grow, h: bh * grow };
    }

    /* Warp + weft. Lines bow with a sine so the mesh reads as cloth under
       tension rather than as a flat grid. */
    function fabric(now, k, alpha, box) {
      var cols = coarse ? 11 : 20, rows = coarse ? 8 : 14;
      var bx = box.x, by = box.y, bw = box.w, bh = box.h;
      ctx.lineWidth = 0.8;

      // Warp (vertical). Bows under tension and fades at the selvedge.
      for (var c = 0; c <= cols; c++) {
        var u = c / cols;
        ctx.globalAlpha = alpha * (0.45 + 0.55 * Math.sin(u * Math.PI));
        ctx.beginPath();
        for (var i = 0; i <= 12; i++) {
          var v = i / 12;
          var bow = Math.sin(v * Math.PI) * Math.sin(now * 0.8 + c * 0.55) * 4.5 * k;
          ctx.lineTo(bx + u * bw + bow, by + v * bh);
        }
        ctx.stroke();
      }
      // Weft (horizontal), stepped over and under every warp: the small
      // alternating offset is what makes the mesh read as interlaced.
      for (var r = 0; r <= rows; r++) {
        var v2 = r / rows;
        ctx.globalAlpha = alpha * (0.4 + 0.6 * Math.sin(v2 * Math.PI)) * 0.9;
        ctx.beginPath();
        var steps = coarse ? cols : cols * 2;
        for (var j = 0; j <= steps; j++) {
          var u2 = j / steps;
          var weave = Math.sin(u2 * cols * Math.PI * 2) * 1.15;
          var bow2 = Math.sin(u2 * Math.PI) * Math.sin(now * 0.7 + r * 0.48) * 3.5 * k;
          ctx.lineTo(bx + u2 * bw, by + v2 * bh + bow2 + weave);
        }
        ctx.stroke();
      }
    }

    function frame(p) {
      if (done || !started || !W) return;
      var stamp = performance.now();
      // The weave draws at ~30fps on every device. The parallax keeps running
      // at the display rate; halving only the canvas is invisible on a soft
      // 1.9s dissolve and bounds the one expensive part of the intro.
      if (stamp - lastDraw < 28) return;
      lastDraw = stamp;
      var now = (stamp - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      if (now > 3.12) { retire(); return; }         // sequence over: free the layer
      if (p > 0.85) return;                         // hero has left: draw nothing

      var kFibre = 1 - span(now, 0.35, 1.00);
      var kThread = span(now, 0.35, 1.00) * (1 - span(now, 0.70, 1.30));
      var kFabric = span(now, 0.70, 1.70);
      var kForm = ease(span(now, 0.70, 1.90));
      var out = 1 - span(now, 1.90, 3.10);          // dissolves to nothing
      var lift = 1 - p * 1.1;                       // fade with scroll
      if (lift <= 0) return;

      ctx.lineCap = "round";

      var A = 0.5 * out * lift;

      if (kFibre > 0.001) {
        // Fibres are few and long, so they can afford the gradient: ink at the
        // edges warming to brand gold through the middle of the stage.
        ctx.strokeStyle = threadGrad;
        var amp = 24 + 26 * kFibre;
        for (var i = 0; i < fib.length; i++) filament(fib[i], now, amp * (0.5 + fib[i].r), A * 1.15 * kFibre, !coarse);
      }
      if (kThread > 0.001) {
        // Three strands braiding around one spine.
        // Three plies twisting around one spine: same phase, opposed offsets.
        for (var s = 0; s < 3; s++) {
          filament({
            f1: 4.2, p1: s * 2.09, f2: 9.4, p2: s * 2.09, f3: 18.1, p3: s * 2.09,
            r: 0.06, s: 1.15, z: 0.72 + s * 0.09, u0: 0.02, u1: 0.98
          }, now, 15 * kThread, A * 1.2 * kThread, !coarse);
        }
      }
      if (kFabric > 0.001) {
        // A flat stroke for the weave: gradient strokes are re-evaluated per
        // pixel and this loop draws ~1000 short segments a frame. The colour
        // shift across the cloth is carried by per-line alpha instead.
        ctx.strokeStyle = "rgba(104,116,92,.95)";
        var box = clothBox(kFabric);
        fabric(now, kFabric, A * 0.9 * kFabric, box);
        // A whisper of body behind the mesh: once the silhouette mask closes
        // in, this is what makes the shape read as cloth rather than as lines.
        ctx.globalAlpha = 0.2 * kFabric * out * lift;
        ctx.fillStyle = bodyGrad;
        ctx.fillRect(box.x, box.y, box.w, box.h);   // only where cloth exists
      }

      // Contract the mesh into the garment: the silhouette starts a little
      // larger than the product and eases down onto its exact box, so the
      // cloth is pulled inward into the shape instead of being cut out of it.
      if (mask && maskBox && kForm > 0.001) {
        var grow = 1 + (1 - kForm) * 0.42;
        var w = maskBox.w * grow, h = maskBox.h * grow;
        var cx = maskBox.x + maskBox.w / 2, cy = maskBox.y + maskBox.h / 2;
        ctx.globalCompositeOperation = "destination-in";
        ctx.globalAlpha = 1;
        ctx.drawImage(mask, cx - w / 2, cy - h / 2, w, h);
        ctx.globalCompositeOperation = "source-over";
      }

      // A slow sheen travelling across the woven form: the "lighting" pass.
      if (!coarse && kForm > 0.2 && out > 0.2 && maskBox) {
        var sx = ((now * 0.16) % 1.6 - 0.3) * W;
        var sh = ctx.createLinearGradient(sx, 0, sx + W * 0.42, H);
        sh.addColorStop(0, "rgba(255,255,255,0)");
        sh.addColorStop(0.5, "rgba(255,255,255," + (0.16 * out * lift).toFixed(3) + ")");
        sh.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = sh;
        ctx.fillRect(maskBox.x, maskBox.y, maskBox.w, maskBox.h);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalAlpha = 1;
    }

    /* Once the sequence has played out the canvas has nothing left to draw,
       so it is hidden: the compositor drops the layer and the shared rAF loop
       is free to park. Nothing here ever runs again. */
    function retire() {
      done = true;
      canvas.hidden = true;
      canvas.width = canvas.height = 0;            // release the backing store
      mask = null;
    }

    function busy() { return started && !done; }
    function idleQuiet() { return !busy(); }

    return { frame: frame, resize: resize, start: start, busy: busy, idleQuiet: idleQuiet };
  })();

  /* ----------------------------------------------------------- lifecycle -- */

  var io = ("IntersectionObserver" in window) && new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting;
    if (visible) wake();
  }, { rootMargin: "80px" });
  if (io) io.observe(hero);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) wake();
  });

  function play() {
    measure();
    readScroll();
    hero.classList.add("is-ready");
    if (!reduced) weave.start();
    wake();
  }

  // Hold the curtain until the product bitmap is decoded, so the entrance
  // never plays against an empty frame. Never wait longer than 900ms.
  var fired = false;
  function once() { if (!fired) { fired = true; play(); } }

  if (garment && garment.decode) {
    garment.decode().then(once).catch(once);
  } else if (garment && !garment.complete) {
    garment.addEventListener("load", once);
    garment.addEventListener("error", once);
  } else {
    once();
  }
  setTimeout(once, 900);
  window.addEventListener("load", function () { measure(); readScroll(); });

  /* ------------------------------------------------------- page reveals -- */

  var reveals = [].slice.call(document.querySelectorAll("[data-reveal]"));
  if (reveals.length && "IntersectionObserver" in window && !reduced) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        ro.unobserve(e.target);            // one-shot: nothing keeps observing
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { ro.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }
})();

/* =========================================================================
   NARRATIVE RAIL + SECTION DEPTH
   A second, deliberately tiny module: it runs on any page carrying [data-rail]
   and is independent of the hero engine above.

   One rAF-throttled scroll handler drives everything, and every measurement it
   needs is cached on load/resize — so the handler itself never reads layout and
   never forces a reflow. It writes one transform on the rail, one class on the
   active chapter, and one transform per in-view [data-parallax] element.
   ========================================================================= */
(function () {
  "use strict";

  var rail = document.querySelector("[data-rail]");
  if (!rail) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fill = rail.querySelector(".rail-fill");
  var marks = [].slice.call(rail.querySelectorAll("[data-anchor]")).map(function (li) {
    return { li: li, el: document.getElementById(li.dataset.anchor), top: 0 };
  }).filter(function (m) { return m.el; });

  var para = reduced ? [] : [].slice.call(document.querySelectorAll("[data-parallax]")).map(function (el) {
    return { el: el, k: parseFloat(el.dataset.parallax) || 0.15, top: 0, h: 0 };
  });

  var docSpan = 1, vh = 0, active = -1, ticking = false;

  function measure() {
    vh = window.innerHeight;
    docSpan = Math.max(1, document.documentElement.scrollHeight - vh);
    for (var i = 0; i < marks.length; i++) {
      marks[i].top = marks[i].el.getBoundingClientRect().top + window.scrollY;
    }
    for (var j = 0; j < para.length; j++) {
      var r = para[j].el.getBoundingClientRect();
      para[j].top = r.top + window.scrollY;
      para[j].h = r.height;
      // Room to move: the image is oversized by the travel it will use, so the
      // parallax can never expose an edge inside its frame.
      para[j].el.style.willChange = "transform";
      para[j].el.style.transform = "";
      para[j].el.style.height = "calc(100% + " + Math.round(para[j].k * 200) + "px)";
      para[j].el.style.marginTop = -Math.round(para[j].k * 100) + "px";
    }
  }

  function frame() {
    ticking = false;
    var y = window.scrollY;

    rail.style.setProperty("--rail", Math.max(0, Math.min(1, y / docSpan)).toFixed(4));

    // The chapter you are in is the last one whose top has passed the upper
    // third of the viewport — the point at which a section reads as "here".
    var line = y + vh * 0.34, next = 0;
    for (var i = 0; i < marks.length; i++) if (marks[i].top <= line) next = i;
    if (next !== active) {
      if (active > -1) marks[active].li.classList.remove("on");
      marks[next].li.classList.add("on");
      active = next;
    }

    for (var j = 0; j < para.length; j++) {
      var p = para[j];
      var rel = (y + vh - p.top) / (vh + p.h);       // 0 entering, 1 leaving
      if (rel < -0.15 || rel > 1.15) continue;
      p.el.style.transform = "translate3d(0," + ((rel - 0.5) * p.k * 150).toFixed(1) + "px,0)";
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { measure(); onScroll(); }, { passive: true });
  window.addEventListener("load", function () { measure(); onScroll(); });
  measure();
  onScroll();
})();
