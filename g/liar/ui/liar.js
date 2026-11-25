/* ═══════════════════════════════════════════════════════════════════════
   The liar's majlis: a real three dimensional table, drawn on the phone.

   Why WebGL and not a stack of divs: the game is a room. Cards arc across
   it, a dallah tips over a tray, four people lean in when the word is said,
   and every one of those reads as a lie unless perspective, depth and light
   agree with each other. A flat table can show the state; only a room can
   show the moment.

   Why the characters are drawn surfaces and not modelled bodies: they are
   the owner's own artwork, and the brief was that they match it exactly. A
   modelled head is an interpretation, and an interpretation of a drawing is
   a different face. So each character is a curved mesh carrying the drawing
   itself, bent around its own axis, breathing, swaying and leaning on the
   vertex shader, lit and shadowed by the same light as the table. It has
   real volume in the scene, real depth against the table edge, and it is
   pixel for pixel the character the owner drew.

   Everything the table draws it owns: no engine, no CDN, one texture atlas
   for the whole deck and one draw call for each surface. It holds sixty
   frames on a phone because there is nothing in the frame that is not
   needed.

   No Arabic lives in this file. Every player facing word comes from
   `locales/ar.json`, and every picture from the art manifest that the
   builder writes.

   Contract with the page: supports / mount / paint / bind / reset / voice.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const ASSETS = '/g/liar';

  /** Every file this table loads carries the version its own script does, so
   *  a phone never pairs a new build with yesterday's words or pictures. */
  const BUILD = (() => {
    try {
      const own = (document.currentScript && document.currentScript.src) || '';
      return new URL(own, location.href).searchParams.get('v') || '';
    } catch (_) { return ''; }
  })();
  const stamp = (url) =>
    (BUILD ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(BUILD)}` : url);

  // ── the deck ──
  const FACES = ['S', 'M', 'T', 'W'];
  // The owner's own four cards: the sun, the moon, the star, and the joker
  // that answers to any of them.
  const SEAT_CHAR = ['alaa', 'shahd', 'noura', 'abusaad'];
  const EMBLEM = {
    alaa: 'sun', shahd: 'moon', noura: 'star', abusaad: 'jewel',
    arshad: 'sun', umsaad: 'moon', rose: 'star', ala: 'jewel', moudi: 'moon', maitha: 'star',
  };
  const ACCENT = {
    alaa: '#e9a82e', shahd: '#4f8ce6', noura: '#a656e0', abusaad: '#e05a72',
    arshad: '#d7a86e', umsaad: '#e0c48a', rose: '#35c6d8', ala: '#f08bb0', moudi: '#9aa3b2', maitha: '#8b8fe6',
  };

  // ── the room, in metres ──
  const TABLE_R = 1.12;         // the wooden top
  const TABLE_Y = 0.74;         // how high it stands
  const SEAT_R = 1.33;          // where the people sit, just past the edge
  const EYE_Y = 1.26;           // the player's own head, seated
  const ROOM_R = 4.3;
  const ROOM_H = 3.3;

  /* Where the four of them sit: quarters of a circle, the way four people
     round a table actually sit. One on the left, one across, one on the
     right, and the player, whose chair is the camera and who is therefore
     never drawn.

     An earlier pass crowded all three opponents onto the far side so that an
     upright phone could hold them in one frame. That is not a table, it is a
     school photograph. The frame is not the problem the seating should solve:
     turning your head is. */
  const seatCount = () => (table && table.players && table.players.length) || 4;

  /* Which chair the phone is sitting in.

     It was nought, always, from the days when the other three were bots and
     the only real person was the one holding the phone. With four real people
     round the table that put all four of them in the same chair, looking out
     of the same eyes — four players in one seat, which is not a majlis but a
     hall of mirrors. The server has always said which chair is yours; this is
     the client finally listening to it. */
  const mySeat = () => (table && table.seat !== null && table.seat !== undefined)
    ? table.seat : 0;
  /* Three ways to sit at this table. `first` is the player's own eyes, the
     way it has always been. `third` stands the camera behind his own chair so
     he sees himself among the others, cards in his character's hand. `top`
     is the lantern's view straight down onto the table — what a watcher gets,
     since a watcher has no chair to see from and no hand to be shown. */
  const VIEWS = ['first', 'third', 'top'];
  let viewPick = (() => {
    try { const v = localStorage.getItem('liar-view'); return VIEWS.includes(v) ? v : 'first'; }
    catch (_) { return 'first'; }
  })();
  const watching = () => !table || table.seat === null || table.seat === undefined;
  const viewMode = () => (watching() && viewPick === 'first' ? 'top' : viewPick);
  // The chair whose body is not drawn because the camera is inside its head.
  const selfSeat = () => (viewMode() === 'first' && !watching() ? mySeat() : -1);
  const seatAngle = (index, count) =>
    Math.PI / 2 + index * Math.PI * 2 / Math.max(2, count || seatCount());

  /* How big a person is.

     The drawings are not one shape. Abu Saad was drawn with his arm up, so
     his picture is half again as wide as it is tall, while Shahd's is square.
     Scaling all four to the same height would seat a giant beside a child, so
     each is fitted inside the same box instead: as tall as it can be without
     being wider than a pair of shoulders. The base sits just under the lip of
     the table, and the wood crops them the way a table does. */
  const FIGURE_BASE = 0.685;
  const FIGURE_H = 0.66;        // the tallest a character may stand
  const FIGURE_W = 0.74;        // and the widest it may spread

  const CARD_W = 0.150;
  // The proportion of the drawn cards, learned from the deck when it loads
  // rather than assumed, so recutting the sheet cannot leave them squashed.
  let CARD_RATIO = 0.716;
  let CARD_H = CARD_W / CARD_RATIO;

  const QUALITY_KEY = 'shahd-liar-quality';
  const MUTE_KEY = 'shahd-liar-mute';
  const QUALITIES = ['high', 'balanced', 'light'];

  // ═══════════════════════════ small numbers ═══════════════════════════

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const back = (t) => { const c = 1.70158 + 1; return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** A repeatable random: the same round shows the same scatter of cards on
   *  every phone, which is the difference between a table and a soup. */
  function seeded(seed) {
    let s = (seed | 0) || 1;
    return () => {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 8) & 0xffffff) / 0xffffff;
    };
  }

  // ═══════════════════════════ matrices ═══════════════════════════
  // Column major, the way the driver wants them. Written out rather than
  // imported: sixty lines against a library, and no version to chase.

  const m4 = {
    make: () => new Float32Array(16),
    identity(o) {
      o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o;
    },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = f / aspect; o[5] = f; o[11] = -1;
      o[10] = (far + near) / (near - far);
      o[14] = 2 * far * near / (near - far);
      return o;
    },
    lookAt(o, eye, at, up) {
      let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
      let len = Math.hypot(zx, zy, zz) || 1;
      zx /= len; zy /= len; zz /= len;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      len = Math.hypot(xx, xy, xz) || 1;
      xx /= len; xy /= len; xz /= len;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    multiply(o, a, b) {
      for (let col = 0; col < 4; col++) {
        const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
        o[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        o[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        o[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        o[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
      }
      return o;
    },
    /** Position, then yaw, then pitch, then roll, then scale. One call
     *  covers every object in the scene, so nothing keeps a private path. */
    compose(o, pos, yaw, pitch, roll, sx, sy, sz) {
      const cy = Math.cos(yaw), sy2 = Math.sin(yaw);
      const cx = Math.cos(pitch), sx2 = Math.sin(pitch);
      const cz = Math.cos(roll), sz2 = Math.sin(roll);
      // R = Ry * Rx * Rz
      const r00 = cy * cz + sy2 * sx2 * sz2;
      const r01 = -cy * sz2 + sy2 * sx2 * cz;
      const r02 = sy2 * cx;
      const r10 = cx * sz2;
      const r11 = cx * cz;
      const r12 = -sx2;
      const r20 = -sy2 * cz + cy * sx2 * sz2;
      const r21 = sy2 * sz2 + cy * sx2 * cz;
      const r22 = cy * cx;
      o[0] = r00 * sx; o[1] = r10 * sx; o[2] = r20 * sx; o[3] = 0;
      o[4] = r01 * sy; o[5] = r11 * sy; o[6] = r21 * sy; o[7] = 0;
      o[8] = r02 * sz; o[9] = r12 * sz; o[10] = r22 * sz; o[11] = 0;
      o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
      return o;
    },
    project(out, m, x, y, z) {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      out[3] = w;
      return out;
    },
  };

  // ═══════════════════════════ the driver ═══════════════════════════

  const VERT_WORLD = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    uniform vec2 uUVScale;
    varying vec3 vNrm; varying vec2 vUV; varying vec3 vWorld;
    void main(){
      vec4 world = uModel * vec4(aPos, 1.0);
      vWorld = world.xyz;
      vNrm = mat3(uModel) * aNrm;
      vUV = aUV * uUVScale;
      gl_Position = uProj * uView * world;
    }`;

  const FRAG_WORLD = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec4 uTint;
    uniform vec3 uSunDir, uSunColor, uAmbient, uFogColor, uEye, uLamp, uLampColor;
    uniform vec2 uFog;
    uniform float uGloss;
    varying vec3 vNrm; varying vec2 vUV; varying vec3 vWorld;
    void main(){
      vec4 base = texture2D(uTex, vUV) * uTint;
      vec3 n = normalize(vNrm);
      vec3 view = normalize(uEye - vWorld);
      float lambert = max(dot(n, uSunDir), 0.0);
      vec3 half3 = normalize(uSunDir + view);
      float spec = pow(max(dot(n, half3), 0.0), 42.0) * uGloss;
      // A warm floor bounce so nothing under the table reads as a hole.
      float bounce = max(-n.y, 0.0) * 0.22;
      // The lamp over the table. Everything in this room is lit by one hanging
      // light and the lanterns on the walls, so the table and the four faces
      // round it are the brightest things in the frame and the rest of the
      // room falls away — which is how a majlis at night actually looks, and
      // it is also what keeps the eye where the cards are.
      vec3 toLamp = uLamp - vWorld;
      float lampDist = length(toLamp);
      float fall = 1.0 / (1.0 + lampDist * lampDist * 0.42);
      float lampLit = max(dot(n, toLamp / max(lampDist, 0.001)), 0.0);

      vec3 lit = base.rgb * (uAmbient + uSunColor * lambert
                 + uLampColor * (lampLit * 0.85 + 0.22) * fall
                 + vec3(0.42, 0.24, 0.12) * bounce)
               + uSunColor * spec * (0.4 + fall);
      float dist = length(uEye - vWorld);
      float fog = clamp((dist - uFog.x) / max(0.001, uFog.y - uFog.x), 0.0, 1.0);
      gl_FragColor = vec4(mix(lit, uFogColor, fog * 0.92), base.a);
    }`;

  const VERT_CARD = `
    attribute vec3 aPos; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    varying vec2 vUV; varying vec3 vWorld; varying vec3 vNrm;
    void main(){
      vec4 world = uModel * vec4(aPos, 1.0);
      vWorld = world.xyz;
      vNrm = mat3(uModel) * vec3(0.0, 0.0, 1.0);
      vUV = aUV;
      gl_Position = uProj * uView * world;
    }`;

  const FRAG_CARD = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec4 uFront, uBack;      // atlas rectangles, xy origin zw size
    uniform vec4 uTint;
    uniform vec3 uSunDir, uSunColor, uAmbient, uFogColor, uEye;
    uniform vec2 uFog;
    varying vec2 vUV; varying vec3 vWorld; varying vec3 vNrm;
    void main(){
      vec4 rect = gl_FrontFacing ? uFront : uBack;
      vec2 uv = gl_FrontFacing ? vUV : vec2(1.0 - vUV.x, vUV.y);
      vec4 base = texture2D(uTex, rect.xy + uv * rect.zw);
      if (base.a < 0.02) discard;
      vec3 n = normalize(gl_FrontFacing ? vNrm : -vNrm);
      vec3 view = normalize(uEye - vWorld);
      float lambert = max(dot(n, uSunDir), 0.0);
      // The lacquer: a narrow band of light that slides across a card as it
      // turns, which is the whole reason a dealt card reads as an object.
      float sheen = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 26.0) * 0.45;
      /* A card is read, not admired. When the room was dimmed so the lamp
         could pick the table out, the deck went down with it and the faces
         the whole game turns on came out muddy. So a card carries its own
         light: almost all of its own colour, with just enough shading left in
         it to say which way it is facing. */
      vec3 lit = base.rgb * (0.88 + 0.26 * lambert) + uSunColor * sheen;
      float dist = length(uEye - vWorld);
      float fog = clamp((dist - uFog.x) / max(0.001, uFog.y - uFog.x), 0.0, 1.0);
      gl_FragColor = vec4(mix(lit, uFogColor, fog * 0.45), base.a) * uTint;
    }`;

  const VERT_FIGURE = `
    attribute vec3 aPos; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    uniform vec4 uWave;        // breath, sway, lean, time
    uniform vec2 uShake;       // amount, speed
    uniform float uBend;
    varying vec2 vUV; varying vec3 vWorld; varying float vUp;
    void main(){
      vec3 p = aPos;
      float up = clamp(1.0 - aUV.y, 0.0, 1.0);   // 1 at the head, 0 at the waist
      vUp = up;
      float t = uWave.w;
      // Real volume: the sheet is pulled backwards at its edges, so the
      // figure has a front and two sides and catches the light like a body.
      p.z -= uBend * p.x * p.x * 4.0;
      p.x += sin(t * 1.15 + up * 2.1) * uWave.y * up * up;
      p.y += sin(t * 1.9) * uWave.x * (0.35 + up * 0.65);
      p.z += uWave.z * up * up;
      p.x += sin(t * uShake.y) * uShake.x * up;
      vec4 world = uModel * vec4(p, 1.0);
      vWorld = world.xyz;
      vUV = aUV;
      gl_Position = uProj * uView * world;
    }`;

  const FRAG_FIGURE = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec4 uTint;
    uniform vec3 uSunColor, uAmbient, uFogColor, uEye, uRim;
    uniform vec2 uFog;
    uniform float uGrey;
    varying vec2 vUV; varying vec3 vWorld; varying float vUp;
    void main(){
      vec4 base = texture2D(uTex, vUV);
      if (base.a < 0.03) discard;
      // Lit from the lanterns above: the top of a seated figure is brighter
      // than its lap, which is what the eye uses to place it in a room.
      float lift = 0.62 + vUp * 0.46;
      vec3 lit = base.rgb * (uAmbient + uSunColor * lift);
      float edge = pow(1.0 - abs(vUV.x - 0.5) * 2.0, 3.0);
      lit += uRim * (1.0 - edge) * 0.55;
      float grey = dot(lit, vec3(0.32, 0.5, 0.18));
      lit = mix(lit, vec3(grey) * 0.82, uGrey);
      float dist = length(uEye - vWorld);
      float fog = clamp((dist - uFog.x) / max(0.001, uFog.y - uFog.x), 0.0, 1.0);
      gl_FragColor = vec4(mix(lit, uFogColor, fog * 0.75), base.a) * uTint;
    }`;

  const VERT_MODEL = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    uniform vec4 uWave;        // breath, sway, lean, time
    uniform vec2 uShake;       // amount, speed
    varying vec2 vUV; varying vec3 vNrm; varying vec3 vWorld;
    void main(){
      vec3 p = aPos;
      // The model stands one unit tall with its feet on the origin, so its own
      // height is the weight: a shoulder moves, a lap barely does.
      float up = clamp(p.y, 0.0, 1.0);
      float t = uWave.w;
      p.x += sin(t * 1.15 + up * 2.1) * uWave.y * up * up;
      p.y += sin(t * 1.9) * uWave.x * (0.35 + up * 0.65);
      p.z += uWave.z * up * up;
      p.x += sin(t * uShake.y) * uShake.x * up;
      vec4 world = uModel * vec4(p, 1.0);
      vWorld = world.xyz;
      vNrm = mat3(uModel) * aNrm;
      vUV = aUV;
      gl_Position = uProj * uView * world;
    }`;

  const FRAG_MODEL = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec4 uTint;
    uniform vec3 uSunColor, uAmbient, uFogColor, uEye, uRim, uSunDir, uLamp, uLampColor;
    uniform vec2 uFog;
    uniform float uGrey;
    varying vec2 vUV; varying vec3 vNrm; varying vec3 vWorld;
    void main(){
      vec4 base = texture2D(uTex, vUV);
      if (base.a < 0.42) discard;
      vec3 n = normalize(vNrm);
      vec3 view = normalize(uEye - vWorld);
      // Wrapped light: a drawn face lit by a hard lambert reads as a mask, and
      // the lanterns in this room are wide and warm anyway.
      float wrap = dot(n, uSunDir) * 0.5 + 0.5;
      float lambert = max(dot(n, uSunDir), 0.0);
      float edge = pow(1.0 - max(dot(n, view), 0.0), 2.6);
      // The lamp over the table. Everything in this room is lit by one hanging
      // light and the lanterns on the walls, so the table and the four faces
      // round it are the brightest things in the frame and the rest of the
      // room falls away — which is how a majlis at night actually looks, and
      // it is also what keeps the eye where the cards are.
      vec3 toLamp = uLamp - vWorld;
      float lampDist = length(toLamp);
      float fall = 1.0 / (1.0 + lampDist * lampDist * 0.42);
      float lampLit = max(dot(n, toLamp / max(lampDist, 0.001)), 0.0);

      vec3 lit = base.rgb * (uAmbient + uSunColor * (0.30 + wrap * 0.46 + lambert * 0.20)
                 + uLampColor * (lampLit * 0.55 + 0.5) * fall);
      lit += uRim * edge;
      float grey = dot(lit, vec3(0.32, 0.5, 0.18));
      lit = mix(lit, vec3(grey) * 0.8, uGrey);
      float dist = length(uEye - vWorld);
      float fog = clamp((dist - uFog.x) / max(0.001, uFog.y - uFog.x), 0.0, 1.0);
      gl_FragColor = vec4(mix(lit, uFogColor, fog * 0.7), base.a) * uTint;
    }`;

  /* The same model again, but moved by its own bones.

     A person at a table is mostly still and occasionally not, and the
     difference between the two is where a card game lives: the reach across
     the wood, the finger that comes up on a call, the head that goes down when
     the round is lost. None of that can be faked by bending a whole body on a
     curve, so the characters carry a skeleton and the skeleton is what moves.

     Twenty four bones is enough for a seated body, and a bone costs three rows
     of four numbers here rather than four: the last row of an affine matrix is
     always the same three zeroes and a one, and the oldest phone this runs on
     counts every vector it is handed. */
  const MAX_BONES = 24;
  const VERT_SKIN = `
    attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;
    attribute vec4 aJoint; attribute vec4 aWeight;
    uniform mat4 uProj, uView, uModel;
    uniform vec4 uBones[${MAX_BONES * 3}];
    uniform vec4 uWave;        // breath, sway, lean, time
    uniform vec2 uShake;       // amount, speed
    varying vec2 vUV; varying vec3 vNrm; varying vec3 vWorld;

    void bone(float index, float weight, vec4 p, vec3 n, inout vec3 op, inout vec3 on){
      int k = int(index) * 3;
      vec4 r0 = uBones[k]; vec4 r1 = uBones[k + 1]; vec4 r2 = uBones[k + 2];
      op += weight * vec3(dot(r0, p), dot(r1, p), dot(r2, p));
      on += weight * vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n));
    }

    void main(){
      vec4 p = vec4(aPos, 1.0);
      vec3 sp = vec3(0.0);
      vec3 sn = vec3(0.0);
      bone(aJoint.x, aWeight.x, p, aNrm, sp, sn);
      bone(aJoint.y, aWeight.y, p, aNrm, sp, sn);
      bone(aJoint.z, aWeight.z, p, aNrm, sp, sn);
      bone(aJoint.w, aWeight.w, p, aNrm, sp, sn);
      // A vertex nobody weighted would collapse onto the origin and drag a
      // spike across the room, so it is left where the modeller put it.
      float sum = aWeight.x + aWeight.y + aWeight.z + aWeight.w;
      float held = step(0.001, sum);
      sp = mix(aPos, sp / max(sum, 0.001), held);
      sn = mix(aNrm, sn / max(sum, 0.001), held);
      // The breath still rides on top: the skeleton says what the body does,
      // this says that it is alive between the things it does.
      float up = clamp(sp.y * 0.7, 0.0, 1.0);
      float t = uWave.w;
      sp.x += sin(t * 1.15 + up * 2.1) * uWave.y * up * up;
      sp.y += sin(t * 1.9) * uWave.x * (0.35 + up * 0.65);
      sp.x += sin(t * uShake.y) * uShake.x * up;
      vec4 world = uModel * vec4(sp, 1.0);
      vWorld = world.xyz;
      vNrm = mat3(uModel) * normalize(sn);
      vUV = aUV;
      gl_Position = uProj * uView * world;
    }`;

  const VERT_SPRITE = `
    attribute vec3 aPos; attribute vec2 aUV;
    uniform mat4 uProj, uView, uModel;
    varying vec2 vUV;
    void main(){ vUV = aUV; gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }`;

  const FRAG_SPRITE = `
    precision mediump float;
    uniform sampler2D uTex; uniform vec4 uTint;
    varying vec2 vUV;
    void main(){
      vec4 base = texture2D(uTex, vUV) * uTint;
      if (base.a < 0.004) discard;
      gl_FragColor = base;
    }`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const why = gl.getShaderInfoLog(shader) || 'shader';
      gl.deleteShader(shader);
      throw new Error(why);
    }
    return shader;
  }

  function program(gl, vertex, fragment) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vertex));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'link');
    }
    const uniforms = {};
    const attributes = {};
    const un = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < un; i++) {
      const info = gl.getActiveUniform(prog, i);
      uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(prog, info.name);
    }
    const an = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < an; i++) {
      const info = gl.getActiveAttrib(prog, i);
      attributes[info.name] = gl.getAttribLocation(prog, info.name);
    }
    return { prog, uniforms, attributes };
  }

  // ═══════════════════════════ geometry ═══════════════════════════

  function mesh(gl, data) {
    const buffers = {};
    const format = {};
    for (const key of ['pos', 'nrm', 'uv', 'jnt', 'wgt']) {
      if (!data[key]) continue;
      // Joints are small whole numbers and travel as bytes; everything else is
      // a float. Sending a bone index as a float costs four times the bus for
      // a number that never exceeds twenty three.
      const raw = data[key];
      const array = raw instanceof Uint8Array || raw instanceof Float32Array
        ? raw : new Float32Array(raw);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      buffers[key] = buffer;
      format[key] = {
        type: array instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.FLOAT,
        normalized: key === 'wgt' && array instanceof Uint8Array,
      };
    }
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    const big = data.pos.length / 3 > 65535;
    const array = big ? new Uint32Array(data.idx) : new Uint16Array(data.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, array, gl.STATIC_DRAW);
    return {
      buffers, format, index, count: data.idx.length,
      type: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
  }

  /** A flat sheet in the XY plane, subdivided so a vertex shader has
   *  something to bend. Origin at the centre bottom. */
  function sheetData(w, h, cols, rows) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= cols; x++) {
        const u = x / cols, v = y / rows;
        pos.push((u - 0.5) * w, (1 - v) * h, 0);
        nrm.push(0, 0, 1);
        uv.push(u, v);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const a = y * (cols + 1) + x, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return { pos, nrm, uv, idx };
  }

  /** A disc in the XZ plane. The UV is polar so a turned wood grain lands
   *  the way a lathe would leave it. */
  function discData(radius, segments, flip) {
    const pos = [0, 0, 0], nrm = [0, flip ? -1 : 1, 0], uv = [0.5, 0.5], idx = [];
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      pos.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      nrm.push(0, flip ? -1 : 1, 0);
      uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    }
    for (let i = 1; i <= segments; i++) {
      if (flip) idx.push(0, i, i + 1); else idx.push(0, i + 1, i);
    }
    return { pos, nrm, uv, idx };
  }

  /** A profile turned about the Y axis: the dallah, the cups, the tray and
   *  the table's pedestal are all one function apart. */
  function latheData(profile, segments, uRepeat) {
    const pos = [], nrm = [], uv = [], idx = [];
    const rings = profile.length;
    for (let r = 0; r < rings; r++) {
      const [radius, y] = profile[r];
      const prev = profile[Math.max(0, r - 1)];
      const next = profile[Math.min(rings - 1, r + 1)];
      const dr = next[0] - prev[0], dy = next[1] - prev[1];
      const len = Math.hypot(dr, dy) || 1;
      const ny = -dr / len, nr = dy / len;
      for (let s = 0; s <= segments; s++) {
        const a = s / segments * Math.PI * 2;
        pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
        nrm.push(Math.cos(a) * nr, ny, Math.sin(a) * nr);
        uv.push(s / segments * (uRepeat || 1), r / (rings - 1));
      }
    }
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < segments; s++) {
        const a = r * (segments + 1) + s, b = a + 1;
        const c = a + segments + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    return { pos, nrm, uv, idx };
  }

  /** An open cylinder seen from the inside: the walls of the majlis. */
  function wallData(radius, height, segments, uRepeat) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let r = 0; r < 2; r++) {
      for (let s = 0; s <= segments; s++) {
        const a = s / segments * Math.PI * 2;
        pos.push(Math.cos(a) * radius, r * height, Math.sin(a) * radius);
        nrm.push(-Math.cos(a), 0, -Math.sin(a));
        uv.push(s / segments * uRepeat, 1 - r);
      }
    }
    for (let s = 0; s < segments; s++) {
      const a = s, b = s + 1, c = s + segments + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    return { pos, nrm, uv, idx };
  }

  /** A flat band lying on the table, from `sweep` radians of a circle.
   *
   *  The whole circle is the table's quiet ring; a slice of it, turned, is
   *  the arm that points at whoever is playing. Both are the same builder,
   *  and both carry their brightness in the texture rather than in a shader:
   *  the sprite's own soft falloff, read across the band, tapers the arc to
   *  nothing at each end so it has no edges to catch the eye.
   */
  function arcData(inner, outer, segments, sweep, taper) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = (t - 0.5) * sweep;
      const c = Math.cos(angle), s = Math.sin(angle);
      const u = taper ? t : 0.5;
      pos.push(c * inner, 0, s * inner);
      nrm.push(0, 1, 0);
      uv.push(u, 0.5);
      pos.push(c * outer, 0, s * outer);
      nrm.push(0, 1, 0);
      uv.push(u, 0.5);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    return { pos, nrm, uv, idx };
  }

  /** Several boxes welded into one mesh, so a chair is one draw. */
  function weld(parts) {
    const pos = [], nrm = [], uv = [], idx = [];
    for (const part of parts) {
      const box = boxData(part.w, part.h, part.d);
      const base = pos.length / 3;
      for (let i = 0; i < box.pos.length; i += 3) {
        pos.push(box.pos[i] + (part.x || 0),
          box.pos[i + 1] + (part.y || 0),
          box.pos[i + 2] + (part.z || 0));
      }
      nrm.push(...box.nrm);
      uv.push(...box.uv);
      for (const index of box.idx) idx.push(index + base);
    }
    return { pos, nrm, uv, idx };
  }

  /** A low majlis chair: a seat, a back and four turned legs. */
  function chairData() {
    const leg = 0.055;
    const parts = [
      { w: 0.46, h: 0.06, d: 0.44, y: 0.40 },
      { w: 0.46, h: 0.52, d: 0.07, y: 0.46, z: -0.19 },
      { w: 0.07, h: 0.10, d: 0.07, y: 0.98, z: -0.19 },
    ];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push({ w: leg, h: 0.40, d: leg, x: sx * 0.19, z: sz * 0.18 });
      }
    }
    return weld(parts);
  }

  function boxData(w, h, d) {
    const pos = [], nrm = [], uv = [], idx = [];
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    const half = [w / 2, h / 2, d / 2];
    faces.forEach((face, index) => {
      const [n, u, v] = face;
      for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        pos.push(
          (n[0] + u[0] * su + v[0] * sv) * half[0],
          (n[1] + u[1] * su + v[1] * sv) * half[1] + h / 2,
          (n[2] + u[2] * su + v[2] * sv) * half[2]);
        nrm.push(n[0], n[1], n[2]);
        uv.push((su + 1) / 2, (sv + 1) / 2);
      }
      const base = index * 4;
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    });
    return { pos, nrm, uv, idx };
  }

  // ═══════════════════════════ textures ═══════════════════════════

  function isPowerOfTwo(value) { return (value & (value - 1)) === 0; }

  function texture(gl, image, repeat) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const pot = isPowerOfTwo(image.width) && isPowerOfTwo(image.height);
    if (pot) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat && pot ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const anis = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anis && pot) {
      gl.texParameterf(gl.TEXTURE_2D, anis.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(4, gl.getParameter(anis.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    return tex;
  }

  function solidTexture(gl, r, g, b, a) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([r, g, b, a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // ═══════════════════════════ models ═══════════════════════════
  /* A reader for glTF 2.0 binaries, written for this table.

     The characters ship as .glb because that is what a three dimensional
     character is: geometry, normals and a material in one standard file that
     any tool can open. The builder writes them from the owner's drawings, and
     anything hand sculpted that is dropped in beside them under the same name
     is loaded in its place without a line of this file changing.

     What is read: nodes and their transforms, meshes and their primitives,
     positions, normals, texture coordinates, indices, the base colour texture
     whether it is embedded in the file or sits next to it, and — when the file
     carries them — the skeleton the mesh hangs from and every clip written
     against it.

     A file with no skeleton is still a file: it is stood upright, scaled to
     one unit and seated the way the drawings were, which is what the four
     built models did before anybody was rigged. */

  const GL_TYPES = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
  };
  const GL_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

  function readAccessor(doc, bin, index) {
    const acc = doc.accessors[index];
    const wide = GL_TYPES[acc.componentType];
    const size = GL_SIZES[acc.type] || 1;
    if (acc.bufferView === undefined) return new wide(acc.count * size);
    const view = doc.bufferViews[acc.bufferView];
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || 0;
    const tight = size * wide.BYTES_PER_ELEMENT;
    if (!stride || stride === tight) {
      return new wide(bin.buffer, bin.byteOffset + start, acc.count * size);
    }
    const out = new wide(acc.count * size);
    for (let i = 0; i < acc.count; i++) {
      out.set(new wide(bin.buffer, bin.byteOffset + start + i * stride, size), i * size);
    }
    return out;
  }

  function nodeMatrix(node) {
    const out = m4.identity(m4.make());
    if (node.matrix) { out.set(node.matrix); return out; }
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const [x, y, z, w] = r;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0];
    out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1];
    out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2];
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2];
    return out;
  }

  /** A node written as one matrix, taken apart into the three things an
   *  animation actually keys. Nothing in these files is sheared, so the
   *  columns are a rotation and their lengths are the scale. */
  function decompose(matrix, out) {
    out.t = [matrix[12], matrix[13], matrix[14]];
    const sx = Math.hypot(matrix[0], matrix[1], matrix[2]) || 1;
    const sy = Math.hypot(matrix[4], matrix[5], matrix[6]) || 1;
    const sz = Math.hypot(matrix[8], matrix[9], matrix[10]) || 1;
    out.s = [sx, sy, sz];
    const m00 = matrix[0] / sx, m01 = matrix[4] / sy, m02 = matrix[8] / sz;
    const m10 = matrix[1] / sx, m11 = matrix[5] / sy, m12 = matrix[9] / sz;
    const m20 = matrix[2] / sx, m21 = matrix[6] / sy, m22 = matrix[10] / sz;
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const k = Math.sqrt(trace + 1) * 2;
      out.r = [(m21 - m12) / k, (m02 - m20) / k, (m10 - m01) / k, k / 4];
    } else if (m00 > m11 && m00 > m22) {
      const k = Math.sqrt(1 + m00 - m11 - m22) * 2;
      out.r = [k / 4, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k];
    } else if (m11 > m22) {
      const k = Math.sqrt(1 + m11 - m00 - m22) * 2;
      out.r = [(m01 + m10) / k, k / 4, (m12 + m21) / k, (m02 - m20) / k];
    } else {
      const k = Math.sqrt(1 + m22 - m00 - m11) * 2;
      out.r = [(m02 + m20) / k, (m12 + m21) / k, k / 4, (m10 - m01) / k];
    }
    return out;
  }

  async function textureFromGltf(doc, bin, base, index) {
    if (index === undefined || !doc.textures) return null;
    const source = doc.textures[index];
    const image = doc.images[source.source === undefined ? 0 : source.source];
    if (!image) return null;
    if (image.bufferView !== undefined) {
      const view = doc.bufferViews[image.bufferView];
      const bytes = new Uint8Array(bin.buffer, bin.byteOffset + (view.byteOffset || 0),
        view.byteLength);
      const blob = new Blob([bytes], { type: image.mimeType || 'image/png' });
      const url = URL.createObjectURL(blob);
      try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
    }
    if (image.uri) return loadImage(new URL(image.uri, base).href);
    return null;
  }

  /** Reads one .glb and hands back drawable parts, already stood upright and
   *  scaled to exactly one unit tall with its feet on the origin, so that any
   *  model at any scale drops into the same seat. */
  async function loadModel(url) {
    const buffer = await fetch(url, { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error('missing');
      return r.arrayBuffer();
    });
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546C67) throw new Error('not a glb');
    let at = 12;
    let doc = null;
    let bin = null;
    while (at + 8 <= view.byteLength) {
      const length = view.getUint32(at, true);
      const kind = view.getUint32(at + 4, true);
      const body = at + 8;
      if (kind === 0x4E4F534A) {
        doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, body, length)));
      } else if (kind === 0x004E4942) {
        bin = new Uint8Array(buffer, body, length);
      }
      at = body + length + ((4 - (length % 4)) % 4);
    }
    if (!doc || !doc.meshes) throw new Error('empty glb');
    if (!bin) bin = new Uint8Array(0);

    const scene = doc.scenes ? doc.scenes[doc.scene || 0] : { nodes: [] };
    const parts = [];
    const box = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };

    const walk = (index, parent) => {
      const node = doc.nodes[index];
      if (!node) return;
      const local = nodeMatrix(node);
      const world = m4.multiply(m4.make(), parent, local);
      /* A skinned mesh carries its own frame in its bones. The standard is
         explicit that the node it hangs from is not applied to it, and folding
         it in anyway applies the skeleton's own placing twice: the body ends
         up somewhere behind its chair, at half its size, with the animation
         still running correctly out of sight. */
      const skinned = node.skin !== undefined;
      const place = skinned ? m4.identity(m4.make()) : world;
      if (node.mesh !== undefined) {
        for (const primitive of (doc.meshes[node.mesh].primitives || [])) {
          const attributes = primitive.attributes || {};
          if (attributes.POSITION === undefined) continue;
          const source = readAccessor(doc, bin, attributes.POSITION);
          const pos = new Float32Array(source.length);
          for (let i = 0; i < source.length; i += 3) {
            const x = source[i], y = source[i + 1], z = source[i + 2];
            pos[i] = place[0] * x + place[4] * y + place[8] * z + place[12];
            pos[i + 1] = place[1] * x + place[5] * y + place[9] * z + place[13];
            pos[i + 2] = place[2] * x + place[6] * y + place[10] * z + place[14];
            for (let k = 0; k < 3; k++) {
              box.lo[k] = Math.min(box.lo[k], pos[i + k]);
              box.hi[k] = Math.max(box.hi[k], pos[i + k]);
            }
          }
          let nrm = null;
          if (attributes.NORMAL !== undefined) {
            const raw = readAccessor(doc, bin, attributes.NORMAL);
            nrm = new Float32Array(raw.length);
            for (let i = 0; i < raw.length; i += 3) {
              const x = raw[i], y = raw[i + 1], z = raw[i + 2];
              const ox = place[0] * x + place[4] * y + place[8] * z;
              const oy = place[1] * x + place[5] * y + place[9] * z;
              const oz = place[2] * x + place[6] * y + place[10] * z;
              const len = Math.hypot(ox, oy, oz) || 1;
              nrm[i] = ox / len; nrm[i + 1] = oy / len; nrm[i + 2] = oz / len;
            }
          }
          const uv = attributes.TEXCOORD_0 !== undefined
            ? new Float32Array(readAccessor(doc, bin, attributes.TEXCOORD_0))
            : new Float32Array((pos.length / 3) * 2);
          let idx;
          if (primitive.indices !== undefined) {
            idx = Array.from(readAccessor(doc, bin, primitive.indices));
          } else {
            idx = Array.from({ length: pos.length / 3 }, (_, i) => i);
          }
          let jnt = null;
          let wgt = null;
          if (skinned && attributes.JOINTS_0 !== undefined
              && attributes.WEIGHTS_0 !== undefined) {
            jnt = Uint8Array.from(readAccessor(doc, bin, attributes.JOINTS_0));
            const raw = readAccessor(doc, bin, attributes.WEIGHTS_0);
            const kind = doc.accessors[attributes.WEIGHTS_0].componentType;
            const full = kind === 5121 ? 255 : kind === 5123 ? 65535 : 1;
            wgt = full === 1 ? Float32Array.from(raw)
              : Float32Array.from(raw, (v) => v / full);
          }
          parts.push({ pos, nrm, uv, idx, jnt, wgt, material: primitive.material });
        }
      }
      for (const child of (node.children || [])) walk(child, world);
    };
    const root = m4.identity(m4.make());
    for (const index of (scene.nodes || [])) walk(index, root);
    if (!parts.length) throw new Error('no geometry');

    const tall = Math.max(1e-4, box.hi[1] - box.lo[1]);
    const rigged = parts.some((part) => part.jnt);
    if (!rigged) {
      // Unrigged, so it is a shape and not a body: stood on the origin and
      // scaled to one unit so any sculpt at any scale drops into the same seat.
      const scale = 1 / tall;
      const midX = (box.hi[0] + box.lo[0]) / 2;
      const midZ = (box.hi[2] + box.lo[2]) / 2;
      for (const part of parts) {
        for (let i = 0; i < part.pos.length; i += 3) {
          part.pos[i] = (part.pos[i] - midX) * scale;
          part.pos[i + 1] = (part.pos[i + 1] - box.lo[1]) * scale;
          part.pos[i + 2] = (part.pos[i + 2] - midZ) * scale;
        }
      }
    }

    /* The skeleton, its rest pose and its clips.
       Everything below is read once, at load, and never again: a frame of the
       game only ever samples numbers that are already in memory. */
    const nodes = (doc.nodes || []).map((node) => {
      const out = { parent: -1, name: String(node.name || ''),
                    t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] };
      if (node.matrix) {
        decompose(node.matrix, out);
      } else {
        if (node.translation) out.t = node.translation.slice();
        if (node.rotation) out.r = node.rotation.slice();
        if (node.scale) out.s = node.scale.slice();
      }
      return out;
    });
    (doc.nodes || []).forEach((node, at) => {
      for (const child of (node.children || [])) {
        if (nodes[child]) nodes[child].parent = at;
      }
    });
    /* The order to walk them in.
       A file is free to list a hand before the arm it hangs from, and this one
       does: the exporter wrote the head first and the hip twentieth. Walking
       the nodes in the order they were written computes a child against
       whatever its parent held last time round, so a skeleton lags a frame per
       joint — still enough to look like it works, which is the dangerous part.
       So the order is sorted once here, parents before children, and every
       frame after that is a straight run down this list. */
    const order = [];
    const done = new Uint8Array(nodes.length);
    const visit = (at) => {
      if (done[at]) return;
      done[at] = 1;
      if (nodes[at].parent >= 0) visit(nodes[at].parent);
      order.push(at);
    };
    for (let at = 0; at < nodes.length; at++) visit(at);

    let skin = null;
    if (rigged && doc.skins && doc.skins.length) {
      const first = doc.skins[0];
      skin = {
        joints: first.joints.slice(),
        ibm: first.inverseBindMatrices !== undefined
          ? new Float32Array(readAccessor(doc, bin, first.inverseBindMatrices))
          : null,
      };
    }

    const clips = {};
    for (const animation of (doc.animations || [])) {
      const channels = [];
      let end = 0;
      for (const channel of (animation.channels || [])) {
        const sampler = (animation.samplers || [])[channel.sampler];
        if (!sampler || !channel.target || channel.target.node === undefined) continue;
        const times = new Float32Array(readAccessor(doc, bin, sampler.input));
        const values = new Float32Array(readAccessor(doc, bin, sampler.output));
        if (!times.length) continue;
        end = Math.max(end, times[times.length - 1]);
        channels.push({
          node: channel.target.node, path: channel.target.path, times, values,
          step: sampler.interpolation === 'STEP',
          cubic: sampler.interpolation === 'CUBICSPLINE',
        });
      }
      // The exporter names a clip after the action it came from, and actions
      // are named once per file, so the second character's idle arrives called
      // `idle.001` and the third's `alaa_idle`. The table wants `idle`.
      const name = String(animation.name || 'clip').split('_').pop()
        .replace(/\.\d+$/, '');
      if (channels.length) clips[name] = { channels, end: Math.max(end, 0.001) };
    }

    return {
      parts, skin, clips, nodes, order, rigged,
      bounds: { lo: box.lo.slice(), hi: box.hi.slice() },
      aspect: (box.hi[0] - box.lo[0]) / tall,
      textureFor: (material) => textureFromGltf(doc, bin, url,
        material !== undefined && doc.materials && doc.materials[material]
          && doc.materials[material].pbrMetallicRoughness
          && doc.materials[material].pbrMetallicRoughness.baseColorTexture
          ? doc.materials[material].pbrMetallicRoughness.baseColorTexture.index
          : undefined),
    };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(url));
      image.src = url;
    });
  }

  // ═══════════════════════════ the room ═══════════════════════════
  /* One scene, built once, redrawn sixty times a second. Nothing here is
     created inside the frame loop: every mesh, texture and matrix below
     outlives the round, and the loop only moves numbers. */

  const scene = {
    gl: null, canvas: null, ready: false, lost: false,
    prog: {}, mesh: {}, tex: {}, art: null, models: {},
    dpr: 1, width: 1, height: 1, wide: false, fov: 1.2,
    proj: m4.make(), view: m4.make(), vp: m4.make(), model: m4.make(),
    camWorld: m4.make(), temp: m4.make(),
    base: [0, EYE_Y, SEAT_R - 0.08], eye: [0, EYE_Y, SEAT_R - 0.08],
    at: [0, 0.90, -0.4], baseYaw: 0, basePitch: -0.26,
    axisX: [1, 0, 0], axisY: [0, 1, 0], axisZ: [0, 0, 1],
    hand: { dist: 0.6, span: 0.2, drop: 0.2 },
    quality: 'balanced',
  };

  /* A first person lens. The head stays where the chair is and the view
     turns inside it, so the vertical angle is what is fixed and the width
     follows the window: a phone sees a narrower slice and turns more, a wide
     screen sees the whole table at once. */
  const FOV_TALL = 1.24;
  const FOV_WIDE = 1.04;

  /* Where the player is looking.

     Drag anywhere that is not a card and you turn your head. The range
     reaches past both neighbours, so every face at the table can be looked at
     directly, and it is left where it is put afterwards — a camera that
     springs back is a camera that argues with you.

     And when the player has not touched it for a few seconds it drifts, very
     slowly, towards whoever is taking their turn. That is not a cut scene: it
     is the same thing a person at a table does without noticing. */
  const orbit = { yaw: 0, pitch: 0, touched: -99, snapAt: -99, snapUntil: -99 };
  const YAW_LIMIT = 1.22;
  const PITCH_LIMIT = 0.46;

  const LIGHT = {
    sun: [0.16, 0.92, 0.36],
    sunColor: [0.62, 0.50, 0.36],
    // Low, so that whatever the lamp does not reach goes quiet.
    ambient: [0.20, 0.16, 0.15],
    fogColor: [0.055, 0.036, 0.030],
    fog: [3.4, 8.6],
    lamp: [0, 2.02, 0],
    lampColor: [1.35, 1.02, 0.62],
  };

  /* The night of the whole majlis has its own air: the lamp burns red and
     low, the dark in the corners turns to wine, and the room is lit as if by
     embers. Blended towards and away from, never switched, so choosing the
     mode on the setup screen feels like the room itself changing its mind. */
  const CALM = JSON.parse(JSON.stringify(LIGHT));
  const ROYALE_LIGHT = {
    sun: [0.10, 0.94, 0.30],
    sunColor: [0.46, 0.20, 0.16],
    ambient: [0.13, 0.07, 0.11],
    fogColor: [0.085, 0.012, 0.020],
    fog: [2.6, 7.4],
    lamp: [0, 2.02, 0],
    lampColor: [1.75, 0.52, 0.26],
  };
  function stepAtmosphere(dt) {
    const royale = !!(table && table.mode === 'royale');
    const want = royale ? ROYALE_LIGHT : CALM;
    const rate = clamp(dt * 1.6, 0, 1);
    // A heart that beats in the lamp while the royale runs.
    const beat = royale ? 1 + Math.pow(Math.max(0, Math.sin(frame * 2.2)), 12) * 0.22 : 1;
    for (const key of Object.keys(want)) {
      for (let i = 0; i < want[key].length; i++) {
        const goal = want[key][i] * (key === 'lampColor' ? beat : 1);
        LIGHT[key][i] += (goal - LIGHT[key][i]) * rate;
      }
    }
  }

  function centeredPlane(cols, rows) {
    const data = sheetData(1, 1, cols || 1, rows || 1);
    for (let i = 1; i < data.pos.length; i += 3) data.pos[i] -= 0.5;
    return data;
  }

  function dallahProfile() {
    return [
      [0.000, 0.000], [0.062, 0.000], [0.070, 0.012], [0.052, 0.030],
      [0.060, 0.070], [0.075, 0.120], [0.070, 0.170], [0.048, 0.205],
      [0.036, 0.225], [0.040, 0.240], [0.030, 0.252], [0.020, 0.268],
      [0.026, 0.286], [0.016, 0.300], [0.000, 0.318],
    ];
  }

  function cupProfile() {
    return [
      [0.000, 0.000], [0.018, 0.000], [0.014, 0.006], [0.020, 0.018],
      [0.028, 0.038], [0.031, 0.052], [0.030, 0.054], [0.026, 0.050],
      [0.024, 0.020], [0.000, 0.008],
    ];
  }

  function pedestalProfile() {
    return [
      [0.000, 0.000], [0.360, 0.000], [0.330, 0.030], [0.150, 0.120],
      [0.120, 0.420], [0.170, 0.560], [0.400, 0.640], [0.900, 0.678],
      [TABLE_R, 0.690], [TABLE_R, TABLE_Y - 0.012], [TABLE_R - 0.018, TABLE_Y],
      [TABLE_R - 0.060, TABLE_Y],
    ];
  }

  function trayProfile() {
    return [
      [0.000, 0.000], [0.230, 0.000], [0.235, 0.006], [0.238, 0.018],
      [0.228, 0.022], [0.214, 0.014], [0.000, 0.011],
    ];
  }

  async function buildScene(canvas, quality) {
    const options = {
      alpha: false, antialias: quality !== 'light', depth: true,
      stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance',
      preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
    };
    const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options)
      || canvas.getContext('experimental-webgl', options);
    if (!gl) throw new Error('nogl');
    scene.gl = gl;
    scene.canvas = canvas;
    scene.quality = quality;

    scene.prog.world = program(gl, VERT_WORLD, FRAG_WORLD);
    scene.prog.card = program(gl, VERT_CARD, FRAG_CARD);
    scene.prog.figure = program(gl, VERT_FIGURE, FRAG_FIGURE);
    scene.prog.model = program(gl, VERT_MODEL, FRAG_MODEL);
    try {
      scene.prog.skin = program(gl, VERT_SKIN, FRAG_MODEL);
    } catch (_) {
      // Twenty four bones is inside every stated limit, but a driver that
      // refuses this shader should cost the table its skeletons and not its
      // room: the built models and the drawings still draw without it.
      scene.prog.skin = null;
    }
    // A model of any size needs indices wider than sixteen bits on the older
    // driver. Asked for once, here, rather than discovered in a black screen.
    gl.getExtension('OES_element_index_uint');
    scene.prog.sprite = program(gl, VERT_SPRITE, FRAG_SPRITE);

    const dense = quality === 'high' ? [14, 20] : quality === 'balanced' ? [10, 14] : [6, 9];
    const round = quality === 'light' ? 36 : 64;
    scene.mesh.floor = mesh(gl, discData(ROOM_R, round, false));
    scene.mesh.ceiling = mesh(gl, discData(ROOM_R, round, true));
    scene.mesh.wall = mesh(gl, wallData(ROOM_R, ROOM_H, round, 5));
    scene.mesh.table = mesh(gl, discData(TABLE_R - 0.06, round, false));
    scene.mesh.pedestal = mesh(gl, latheData(pedestalProfile(), round, 1));
    scene.mesh.chair = mesh(gl, chairData());
    scene.mesh.pot = mesh(gl, latheData([
      [0.000, 0.000], [0.170, 0.000], [0.185, 0.030], [0.150, 0.130],
      [0.120, 0.210], [0.140, 0.250], [0.120, 0.275], [0.000, 0.285],
    ], round >> 1, 1));
    scene.mesh.dallah = mesh(gl, latheData(dallahProfile(), round >> 1, 1));
    scene.mesh.cup = mesh(gl, latheData(cupProfile(), 24, 1));
    scene.mesh.tray = mesh(gl, latheData(trayProfile(), round >> 1, 1));
    scene.mesh.figure = mesh(gl, sheetData(1, 1, dense[0], dense[1]));
    scene.mesh.card = mesh(gl, centeredPlane(1, 1));
    scene.mesh.ring = mesh(gl, arcData(TABLE_R * 0.52, TABLE_R * 0.60,
      round, Math.PI * 2, false));
    scene.mesh.arc = mesh(gl, arcData(TABLE_R * 0.40, TABLE_R * 0.72,
      Math.max(18, round >> 1), 1.45, true));
    scene.mesh.sprite = mesh(gl, centeredPlane(1, 1));

    scene.tex.white = solidTexture(gl, 255, 255, 255, 255);
    scene.tex.dark = solidTexture(gl, 26, 18, 16, 255);

    const manifest = await fetch(stamp(ASSETS + '/art/manifest.json'), { cache: 'force-cache' })
      .then((response) => response.json());
    scene.art = manifest;
    if (manifest.deck && manifest.deck.ratio) {
      CARD_RATIO = manifest.deck.ratio;
      CARD_H = CARD_W / CARD_RATIO;
    }

    const wanted = [
      ['cards', manifest.deck.file, false],
      ['table', manifest.room['table-top'].file, false],
      ['carpet', manifest.room.carpet.file, true],
      ['wall', manifest.room.wall.file, true],
      ['brass', manifest.room.brass.file, true],
      ['glow', manifest.room.glow.file, false],
      ['shadow', manifest.room.shadow.file, false],
    ];
    for (const key of Object.keys(manifest.characters)) {
      wanted.push(['char-' + key, manifest.characters[key].file, false]);
    }
    const images = await Promise.all(wanted.map((entry) =>
      loadImage(stamp(ASSETS + '/art/' + entry[1])).catch(() => null)));
    wanted.forEach((entry, index) => {
      const image = images[index];
      scene.tex[entry[0]] = image ? texture(gl, image, entry[2]) : scene.tex.white;
      if (image && entry[0].indexOf('char-') === 0) {
        scene.tex[entry[0] + '-ratio'] = image.width / image.height;
      }
    });

    await loadModels(gl);

    gl.clearColor(LIGHT.fogColor[0], LIGHT.fogColor[1], LIGHT.fogColor[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    scene.ready = true;
    return scene;
  }

  /** Normals for a model that arrived without any: a hand made GLB is not
   *  obliged to carry them, and a surface with no normal takes no light. */
  function ensureNormals(part) {
    if (part.nrm && part.nrm.length === part.pos.length) return part.nrm;
    const nrm = new Float32Array(part.pos.length);
    for (let i = 0; i + 2 < part.idx.length; i += 3) {
      const a = part.idx[i] * 3, b = part.idx[i + 1] * 3, c = part.idx[i + 2] * 3;
      const ux = part.pos[b] - part.pos[a];
      const uy = part.pos[b + 1] - part.pos[a + 1];
      const uz = part.pos[b + 2] - part.pos[a + 2];
      const vx = part.pos[c] - part.pos[a];
      const vy = part.pos[c + 1] - part.pos[a + 1];
      const vz = part.pos[c + 2] - part.pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const at of [a, b, c]) {
        nrm[at] += nx; nrm[at + 1] += ny; nrm[at + 2] += nz;
      }
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const len = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= len; nrm[i + 1] /= len; nrm[i + 2] /= len;
    }
    part.nrm = nrm;
    return nrm;
  }

  /** Four characters, as models. A file that will not load costs that one
   *  seat its geometry and nothing else: the drawing stands in its place. */
  async function loadModels(gl) {
    const index = await fetch(stamp(ASSETS + '/art/models.json'), { cache: 'force-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    scene.modelIndex = (index && index.models) || {};
    scene.modelLoading = {};
    // The four first faces load before the table opens; every other
    // character is fetched the first time somebody sits down wearing it, so
    // a phone never downloads eleven people to seat four.
    await Promise.all(SEAT_CHAR.filter((key) => scene.modelIndex[key]).map((key) => loadOneModel(gl, key)));
  }

  function wantModel(key) {
    if (!scene.modelIndex || scene.models[key] || scene.modelLoading[key] || !scene.modelIndex[key]) return;
    // A file that failed to arrive — a dropped connection on a phone, a
    // texture the GPU would not take — is asked for again a little later
    // instead of leaving that chair empty for the rest of the evening.
    scene.modelLoading[key] = loadOneModel(scene.gl, key).then(() => {
      if (!scene.models[key]) window.setTimeout(() => { delete scene.modelLoading[key]; }, 3000);
    });
  }

  async function loadOneModel(gl, key) {
    const wanted = scene.modelIndex;
    if (!gl || (gl.isContextLost && gl.isContextLost())) return;
    {
      try {
        const loaded = await loadModel(stamp(ASSETS + '/art/' + wanted[key].file));
        const parts = [];
        for (const part of loaded.parts) {
          ensureNormals(part);
          const image = await loaded.textureFor(part.material).catch(() => null);
          parts.push({
            mesh: mesh(gl, {
              pos: part.pos, nrm: part.nrm, uv: part.uv, idx: part.idx,
              jnt: part.jnt, wgt: part.wgt,
            }),
            tex: image ? texture(gl, image, false) : null,
          });
        }
        if (!parts.length) return;
        const note = wanted[key] || {};
        const box = loaded.bounds;
        scene.models[key] = {
          parts, aspect: loaded.aspect,
          // A rigged body is a person, in metres, sitting on its own floor. An
          // unrigged one is a shape one unit tall, which is what the built
          // models were and what a hand made drop in is allowed to be.
          rigged: loaded.rigged && !!loaded.skin && !!loaded.parts[0].jnt
            && loaded.skin.joints.length <= MAX_BONES,
          skin: loaded.skin, nodes: loaded.nodes, order: loaded.order,
          clips: loaded.clips || {},
          tall: note.tall || (box ? box.hi[1] - box.lo[1] : 1),
          hip: note.hip !== undefined ? note.hip
            : (box ? (box.hi[1] - box.lo[1]) * 0.42 : 0.42),
          // The bone the fan of cards is held in, and where in that bone's own
          // frame it sits. Found by name so that a character somebody else
          // rigged is held to nothing but calling its left hand a left hand.
          handNode: handOf(loaded, (note.hand && note.hand.bone) || 'L_Hand'),
          headNode: boneNamed(loaded, 'Head'),
          headJoint: jointNamed(loaded, 'Head'),
          handOffset: (note.hand && note.hand.offset) || [0, 0.045, 0.055],
          // Where the character sits in its own seat, as one matrix written
          // by the arrangement pass. A file that carries one is placed by it
          // and by nothing else; a file without one is placed the old way,
          // off its hip, which is all a hand made drop in can offer.
          local: note.local && note.local.length === 16
            ? new Float32Array(note.local) : null,
          top: note.top || 0,
          place: note.place || null,
        };
      } catch (_) { /* the drawing stands in for it */ }
    }
  }

  /** Which node is the hand, by name. Anything that is a left hand answers to
   *  one of these, and a file that answers to none of them keeps its cards in
   *  front of its chest the way the drawings did. */
  /** A joint by name, as a node index and as a place in the skin's own list.
   *  Both are needed: the pose is kept per node and the shader is fed per
   *  joint, and on a rig somebody else made they are not the same number. */
  function boneNamed(loaded, wanted) {
    if (!loaded.skin || !loaded.nodes) return -1;
    const want = wanted.toLowerCase();
    const at = loaded.skin.joints.find((index) => {
      const node = loaded.nodes[index];
      return node && node.name.toLowerCase() === want;
    });
    return at === undefined ? -1 : at;
  }

  function jointNamed(loaded, wanted) {
    if (!loaded.skin || !loaded.nodes) return -1;
    const want = wanted.toLowerCase();
    return loaded.skin.joints.findIndex((index) => {
      const node = loaded.nodes[index];
      return node && node.name.toLowerCase() === want;
    });
  }

  function handOf(loaded, wanted) {
    if (!loaded.skin || !loaded.nodes) return -1;
    const named = (test) => loaded.skin.joints.find((at) => {
      const node = loaded.nodes[at];
      return node && test(node.name.toLowerCase());
    });
    const found = named((name) => name === wanted.toLowerCase())
      || named((name) => /(^|[._ -])(l|left)([._ -]|$)/.test(name) && name.includes('hand'))
      || named((name) => name.includes('hand'));
    return found === undefined ? -1 : found;
  }

  /* ═══════════════════════════ skeletons ═══════════════════════════

     What a clip is, once it is in memory: a list of channels, each one a bone,
     a thing about that bone, a column of times and a column of values. Playing
     it is reading two neighbouring rows and mixing them, and posing a body is
     doing that for every channel, walking the bones from the hip outwards, and
     handing the result to the shader as twenty four little matrices.

     Two clips are read at a time, never one. A body that snaps from sitting
     still to throwing a card reads as a glitch; a quarter of a second of both
     at once reads as a person. */

  const QUAT_A = [0, 0, 0, 1];
  const QUAT_B = [0, 0, 0, 1];

  function sampleChannel(channel, time, out) {
    const times = channel.times;
    const size = channel.path === 'rotation' ? 4 : 3;
    const last = times.length - 1;
    let at = 0;
    if (time <= times[0]) {
      at = 0;
    } else if (time >= times[last]) {
      at = last;
    } else {
      let low = 0;
      let high = last;
      while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (times[mid] <= time) low = mid; else high = mid;
      }
      at = low;
    }
    const stride = channel.cubic ? size * 3 : size;
    const pick = channel.cubic ? size : 0;
    const base = at * stride + pick;
    if (at === last || channel.step || times[at + 1] === times[at]) {
      for (let i = 0; i < size; i++) out[i] = channel.values[base + i];
      return;
    }
    const span = times[at + 1] - times[at];
    const k = (time - times[at]) / span;
    const next = (at + 1) * stride + pick;
    if (size === 4) {
      // Quaternions take the short way round: without the sign check a bone
      // occasionally travels the long way and the arm swings through the body.
      let dot = 0;
      for (let i = 0; i < 4; i++) dot += channel.values[base + i] * channel.values[next + i];
      const flip = dot < 0 ? -1 : 1;
      let len = 0;
      for (let i = 0; i < 4; i++) {
        out[i] = channel.values[base + i] * (1 - k) + channel.values[next + i] * flip * k;
        len += out[i] * out[i];
      }
      len = Math.sqrt(len) || 1;
      for (let i = 0; i < 4; i++) out[i] /= len;
      return;
    }
    for (let i = 0; i < size; i++) {
      out[i] = channel.values[base + i] * (1 - k) + channel.values[next + i] * k;
    }
  }

  /** Every bone's local place at one instant of one clip, written over the
   *  rest pose the file was saved in. */
  function samplePose(model, clip, time, into) {
    const nodes = model.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const rest = nodes[i];
      const slot = into[i];
      slot[0] = rest.t[0]; slot[1] = rest.t[1]; slot[2] = rest.t[2];
      slot[3] = rest.r[0]; slot[4] = rest.r[1]; slot[5] = rest.r[2]; slot[6] = rest.r[3];
      slot[7] = rest.s[0]; slot[8] = rest.s[1]; slot[9] = rest.s[2];
    }
    if (!clip) return;
    for (const channel of clip.channels) {
      const slot = into[channel.node];
      if (!slot) continue;
      if (channel.path === 'rotation') {
        sampleChannel(channel, time, QUAT_A);
        slot[3] = QUAT_A[0]; slot[4] = QUAT_A[1];
        slot[5] = QUAT_A[2]; slot[6] = QUAT_A[3];
      } else if (channel.path === 'translation') {
        sampleChannel(channel, time, QUAT_A);
        slot[0] = QUAT_A[0]; slot[1] = QUAT_A[1]; slot[2] = QUAT_A[2];
      } else if (channel.path === 'scale') {
        sampleChannel(channel, time, QUAT_A);
        slot[7] = QUAT_A[0]; slot[8] = QUAT_A[1]; slot[9] = QUAT_A[2];
      }
    }
  }

  function blendPose(from, onto, k) {
    for (let i = 0; i < onto.length; i++) {
      const a = from[i];
      const b = onto[i];
      for (let j = 0; j < 3; j++) b[j] = a[j] + (b[j] - a[j]) * k;
      for (let j = 7; j < 10; j++) b[j] = a[j] + (b[j] - a[j]) * k;
      const dot = a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6];
      const flip = dot < 0 ? -1 : 1;
      let len = 0;
      for (let j = 3; j < 7; j++) {
        b[j] = a[j] * (1 - k) + b[j] * flip * k;
        len += b[j] * b[j];
      }
      len = Math.sqrt(len) || 1;
      for (let j = 3; j < 7; j++) b[j] /= len;
    }
  }

  function trsMatrix(out, slot) {
    const x = slot[3], y = slot[4], z = slot[5], w = slot[6];
    const sx = slot[7], sy = slot[8], sz = slot[9];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx;
    out[3] = 0;
    out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy;
    out[7] = 0;
    out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;
    out[12] = slot[0]; out[13] = slot[1]; out[14] = slot[2]; out[15] = 1;
    return out;
  }

  /** The pose, as the shader wants it: three rows of four for each bone, the
   *  bone's place in the world of the model times the pose it was bound in. */
  function boneMatrices(model, pose, world, out) {
    const nodes = model.nodes;
    const local = trsScratch;
    for (const i of model.order) {
      trsMatrix(local, pose[i]);
      const parent = nodes[i].parent;
      if (parent < 0) {
        world[i].set(local);
      } else {
        m4.multiply(world[i], world[parent], local);
      }
    }
    const joints = model.skin.joints;
    const ibm = model.skin.ibm;
    const count = Math.min(joints.length, MAX_BONES);
    for (let i = 0; i < count; i++) {
      const node = world[joints[i]];
      let m = node;
      if (ibm) {
        m4.multiply(boneScratch, node, ibmView(ibm, i));
        m = boneScratch;
      }
      const at = i * 12;
      out[at] = m[0]; out[at + 1] = m[4]; out[at + 2] = m[8]; out[at + 3] = m[12];
      out[at + 4] = m[1]; out[at + 5] = m[5]; out[at + 6] = m[9]; out[at + 7] = m[13];
      out[at + 8] = m[2]; out[at + 9] = m[6]; out[at + 10] = m[10]; out[at + 11] = m[14];
    }
  }

  /** One head, turned towards whoever is looking at it.
   *
   *  Written straight onto the head's world matrix after the clip has been
   *  read, rather than into the pose, because a glTF bone has no agreed idea
   *  which way its own axes point and a rotation guessed in the wrong frame
   *  lays a character's face on its shoulder. Turned about the model's own
   *  upright axis, through the neck, so a head that turns does not travel.
   *
   *  The head is the last bone on its branch, so nothing downstream has to be
   *  computed again — only the one row the shader reads. */
  const headSpin = m4.make();
  const headFlat = m4.make();
  const headOut = m4.make();
  function turnHead(model, player, yaw) {
    const node = model.headNode;
    const at = model.headJoint;
    if (node < 0 || at < 0 || at >= MAX_BONES || !player.world[node]) return;
    const world = player.world[node];
    m4.compose(headSpin, [world[12], world[13], world[14]], yaw, 0, 0, 1, 1, 1);
    headFlat.set(world);
    headFlat[12] = 0; headFlat[13] = 0; headFlat[14] = 0;
    m4.multiply(headOut, headSpin, headFlat);
    world.set(headOut);
    const ibm = model.skin.ibm;
    let m = world;
    if (ibm) { m4.multiply(boneScratch, world, ibmView(ibm, at)); m = boneScratch; }
    const row = at * 12;
    const out = player.bones;
    out[row] = m[0]; out[row + 1] = m[4]; out[row + 2] = m[8]; out[row + 3] = m[12];
    out[row + 4] = m[1]; out[row + 5] = m[5]; out[row + 6] = m[9]; out[row + 7] = m[13];
    out[row + 8] = m[2]; out[row + 9] = m[6]; out[row + 10] = m[10]; out[row + 11] = m[14];
  }

  const trsScratch = m4.make();
  const boneScratch = m4.make();
  const ibmSlice = m4.make();
  function ibmView(ibm, index) {
    ibmSlice.set(ibm.subarray(index * 16, index * 16 + 16));
    return ibmSlice;
  }

  /** One seat's playback: what it is doing, what it was doing a moment ago,
   *  and how far it has crossed from the one to the other. */
  function newPlayer(model) {
    const slots = [];
    const world = [];
    for (let i = 0; i < model.nodes.length; i++) {
      slots.push(new Float32Array(10));
      world.push(m4.make());
    }
    return {
      // Started at a different point in the loop for each seat, because four
      // people breathing in time with each other is a chorus line.
      clip: 'idle', at: Math.random() * 5.9, prev: null, prevAt: 0,
      fade: 1, once: false,
      pose: slots, was: model.nodes.map(() => new Float32Array(10)),
      world, bones: new Float32Array(MAX_BONES * 12),
    };
  }

  const CLIP_FOR = {
    throw: 'throw', challenge: 'call', caught: 'lose', safe: 'win', out: 'out',
  };

  // Being out of the round is not something a person does and then stops
  // doing, so that one clip stops on its last frame and stays there.
  const CLIP_HOLDS = { out: true };

  function playClip(player, model, name, once) {
    if (!model.clips[name] || player.clip === name) return;
    player.prev = player.clip;
    player.prevAt = player.at;
    player.clip = name;
    player.at = 0;
    player.fade = 0;
    player.once = !!once;
  }

  function stepPlayer(player, model, mood, dt) {
    player.at += dt;
    player.prevAt += dt;
    if (player.fade < 1) player.fade = Math.min(1, player.fade + dt * 5.5);
    const want = mood.wants || 'idle';
    const playing = model.clips[player.clip];
    if (player.once) {
      if (!playing || player.at >= playing.end) {
        player.once = false;
        playClip(player, model, want, false);
      }
    } else if (want !== player.clip) {
      playClip(player, model, want, false);
    }
    const clip = model.clips[player.clip];
    if (!clip) return;
    const held = player.once || CLIP_HOLDS[player.clip];
    const time = held ? Math.min(player.at, clip.end) : player.at % clip.end;
    samplePose(model, clip, time, player.pose);
    if (player.fade < 1 && player.prev && model.clips[player.prev]) {
      const old = model.clips[player.prev];
      const back = CLIP_HOLDS[player.prev]
        ? Math.min(player.prevAt, old.end) : player.prevAt % old.end;
      samplePose(model, old, back, player.was);
      blendPose(player.was, player.pose, player.fade);
    }
    boneMatrices(model, player.pose, player.world, player.bones);
    if (mood && mood.look > 0.004) turnHead(model, player, mood.look * mood.lookYaw);
  }

  // ═══════════════════════════ drawing ═══════════════════════════

  let bound = null;

  function use(prog) {
    const gl = scene.gl;
    if (bound !== prog) { gl.useProgram(prog.prog); bound = prog; }
    return prog;
  }

  const ATTR_MAP = {
    aPos: ['pos', 3], aNrm: ['nrm', 3], aUV: ['uv', 2],
    aJoint: ['jnt', 4], aWeight: ['wgt', 4],
  };

  function attach(prog, meshObj) {
    const gl = scene.gl;
    for (const name of Object.keys(prog.attributes)) {
      const entry = ATTR_MAP[name];
      const location = prog.attributes[name];
      if (!entry || location < 0) continue;
      const buffer = meshObj.buffers[entry[0]];
      if (!buffer) { gl.disableVertexAttribArray(location); continue; }
      const fmt = (meshObj.format && meshObj.format[entry[0]])
        || { type: gl.FLOAT, normalized: false };
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, entry[1], fmt.type, fmt.normalized, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshObj.index);
  }

  const U = {
    f: (p, n, v) => { const l = p.uniforms[n]; if (l) scene.gl.uniform1f(l, v); },
    v2: (p, n, v) => { const l = p.uniforms[n]; if (l) scene.gl.uniform2fv(l, v); },
    v3: (p, n, v) => { const l = p.uniforms[n]; if (l) scene.gl.uniform3fv(l, v); },
    v4: (p, n, v) => { const l = p.uniforms[n]; if (l) scene.gl.uniform4fv(l, v); },
    m4: (p, n, v) => { const l = p.uniforms[n]; if (l) scene.gl.uniformMatrix4fv(l, false, v); },
    tex: (p, n, t) => {
      const l = p.uniforms[n];
      if (!l) return;
      scene.gl.activeTexture(scene.gl.TEXTURE0);
      scene.gl.bindTexture(scene.gl.TEXTURE_2D, t || scene.tex.white);
      scene.gl.uniform1i(l, 0);
    },
  };

  function lighting(prog) {
    U.m4(prog, 'uProj', scene.proj);
    U.m4(prog, 'uView', scene.view);
    U.v3(prog, 'uSunDir', LIGHT.sun);
    U.v3(prog, 'uSunColor', LIGHT.sunColor);
    U.v3(prog, 'uAmbient', LIGHT.ambient);
    U.v3(prog, 'uFogColor', LIGHT.fogColor);
    U.v3(prog, 'uEye', scene.eye);
    U.v2(prog, 'uFog', LIGHT.fog);
    U.v3(prog, 'uLamp', LIGHT.lamp);
    U.v3(prog, 'uLampColor', LIGHT.lampColor);
  }

  function drawWorld(meshObj, tex, pos, yaw, scaleXYZ, opts) {
    const prog = use(scene.prog.world);
    attach(prog, meshObj);
    m4.compose(scene.model, pos, yaw || 0, (opts && opts.pitch) || 0, 0,
      scaleXYZ[0], scaleXYZ[1], scaleXYZ[2]);
    U.m4(prog, 'uModel', scene.model);
    U.v2(prog, 'uUVScale', (opts && opts.uv) || [1, 1]);
    U.v4(prog, 'uTint', (opts && opts.tint) || [1, 1, 1, 1]);
    U.f(prog, 'uGloss', (opts && opts.gloss) || 0);
    U.tex(prog, 'uTex', tex);
    scene.gl.drawElements(scene.gl.TRIANGLES, meshObj.count, meshObj.type, 0);
  }

  function drawSprite(tex, pos, size, tint, yaw, pitch) {
    const prog = use(scene.prog.sprite);
    attach(prog, scene.mesh.sprite);
    m4.compose(scene.model, pos, yaw || 0, pitch === undefined ? -Math.PI / 2 : pitch, 0,
      size[0], size[1], 1);
    U.m4(prog, 'uProj', scene.proj);
    U.m4(prog, 'uView', scene.view);
    U.m4(prog, 'uModel', scene.model);
    U.v4(prog, 'uTint', tint || [1, 1, 1, 1]);
    U.tex(prog, 'uTex', tex);
    scene.gl.drawElements(scene.gl.TRIANGLES, scene.mesh.sprite.count, scene.mesh.sprite.type, 0);
  }

  function atlasRect(key) {
    const deck = scene.art && scene.art.deck;
    if (!deck) return [0, 0, 1, 1];
    const cell = deck.cells[key] || deck.cells.back;
    const width = deck.size[0], height = deck.size[1];
    return [cell.x / width, cell.y / height, cell.w / width, cell.h / height];
  }

  /** One card, anywhere: on the table, in the air, or held at the eye. The
   *  matrix arrives ready made, so the same call draws all three. */
  function drawCard(matrix, face, tint) {
    const prog = use(scene.prog.card);
    attach(prog, scene.mesh.card);
    U.m4(prog, 'uModel', matrix);
    U.v4(prog, 'uFront', atlasRect(face || 'back'));
    U.v4(prog, 'uBack', atlasRect('back'));
    U.v4(prog, 'uTint', tint || [1, 1, 1, 1]);
    U.tex(prog, 'uTex', scene.tex.cards);
    scene.gl.drawElements(scene.gl.TRIANGLES, scene.mesh.card.count, scene.mesh.card.type, 0);
  }

  /** One character, from the model the builder made of the owner's drawing.
   *
   *  A seat faces the middle of the table, and then turns its shoulders part
   *  of the way towards whoever is holding the phone. Not all the way: a room
   *  where everybody stares at the camera is a shop window, not a majlis.
   */
  function drawFigure(key, pos, height, mood, tint) {
    const model = scene.models[key];
    if (!model) wantModel(key);
    const gl = scene.gl;
    if (model && model.rigged && mood.bones && scene.prog.skin) {
      drawPerson(key, model, pos, mood, tint);
      return;
    }
    // Squarely towards the eye. The relief carries the volume; turning it
    // away would show the player its thin side, and a thin side is the one
    // thing a drawing standing in a room must never show.
    const yaw = Math.atan2(scene.eye[0] - pos[0], scene.eye[2] - pos[2]);
    const toEye = yaw;
    const wide = model ? model.aspect : (scene.tex['char-' + key + '-ratio'] || 0.9);
    const fit = Math.min(height, FIGURE_W / Math.max(0.25, wide));

    if (!model) {
      // No model on the shelf: the drawing itself, on a curved sheet. The
      // table never goes blank because a file is missing.
      const prog = use(scene.prog.figure);
      attach(prog, scene.mesh.figure);
      m4.compose(scene.model, pos, toEye, 0, 0, fit * wide, fit, fit);
      U.m4(prog, 'uProj', scene.proj);
      U.m4(prog, 'uView', scene.view);
      U.m4(prog, 'uModel', scene.model);
      U.v4(prog, 'uWave', mood.wave);
      U.v2(prog, 'uShake', mood.shake);
      U.f(prog, 'uBend', mood.bend);
      U.f(prog, 'uGrey', mood.grey || 0);
      U.v3(prog, 'uRim', mood.rim || [0.20, 0.13, 0.07]);
      U.v4(prog, 'uTint', tint || [1, 1, 1, 1]);
      U.v3(prog, 'uSunColor', LIGHT.sunColor);
      U.v3(prog, 'uAmbient', LIGHT.ambient);
      U.v3(prog, 'uFogColor', LIGHT.fogColor);
      U.v3(prog, 'uEye', scene.eye);
      U.v2(prog, 'uFog', LIGHT.fog);
      U.v3(prog, 'uLamp', LIGHT.lamp);
      U.v3(prog, 'uLampColor', LIGHT.lampColor);
      U.tex(prog, 'uTex', scene.tex['char-' + key]);
      gl.drawElements(gl.TRIANGLES, scene.mesh.figure.count, scene.mesh.figure.type, 0);
      return;
    }

    const prog = use(scene.prog.model);
    const down = mood.fall || 0;
    m4.compose(scene.model, [pos[0], pos[1] - down * 0.16, pos[2]],
      yaw, down * 1.02, 0, fit, fit, fit);
    U.m4(prog, 'uProj', scene.proj);
    U.m4(prog, 'uView', scene.view);
    U.m4(prog, 'uModel', scene.model);
    U.v4(prog, 'uWave', mood.wave);
    U.v2(prog, 'uShake', mood.shake);
    U.f(prog, 'uGrey', mood.grey || 0);
    U.v3(prog, 'uRim', mood.rim || [0.20, 0.13, 0.07]);
    U.v4(prog, 'uTint', tint || [1, 1, 1, 1]);
    U.v3(prog, 'uSunDir', LIGHT.sun);
    U.v3(prog, 'uSunColor', LIGHT.sunColor);
    U.v3(prog, 'uAmbient', LIGHT.ambient);
    U.v3(prog, 'uFogColor', LIGHT.fogColor);
    U.v3(prog, 'uEye', scene.eye);
    U.v2(prog, 'uFog', LIGHT.fog);
    U.v3(prog, 'uLamp', LIGHT.lamp);
    U.v3(prog, 'uLampColor', LIGHT.lampColor);
    for (const part of model.parts) {
      attach(prog, part.mesh);
      U.tex(prog, 'uTex', part.tex || scene.tex['char-' + key]);
      gl.drawElements(gl.TRIANGLES, part.mesh.count, part.mesh.type, 0);
    }
  }

  /** A whole person, on a chair, moved by their own skeleton.
   *
   *  Where they sit is settled by the hip and not by the feet: the model was
   *  saved with its own hip height written beside it, and the chair in this
   *  room is a known 0.43 off the floor, so a tall body and a short one both
   *  end up sitting on the seat rather than hovering over it or sunk through
   *  it. What that costs is feet under the floor for the tallest of them,
   *  which no one will ever see: the table is between the player and every
   *  pair of feet at this table.
   *
   *  And they face the middle of the table, not the camera — turned a fifth of
   *  the way towards whoever is holding the phone, because a person at a
   *  majlis half turns towards whoever just spoke, and a room where everybody
   *  stares out of the screen is a shop window. */
  const FIGURE_SCALE = 1.05;
  // The top of the cushion, as chairData actually builds it: legs 0.40 tall
  // with a 0.06 seat standing on them. It read 0.43 for a long time, and
  // three centimetres is the difference between sitting on a chair and
  // sitting three centimetres inside one.
  const CHAIR_TOP = 0.46;
  const CHAIR_R = SEAT_R - 0.06;

  /** Where a seated body stands in the room: on its chair, facing the middle
   *  of the table and nothing else. Solved in one place because two things
   *  need it — the body, and the cards in its hand.
   *
   *  It used to turn everybody a fifth of the way towards whoever was holding
   *  the phone, on the argument that a person at a majlis half turns towards
   *  whoever just spoke. On four sculpted bodies it read as a room full of
   *  people staring at the camera, so they now sit the way they were sat. */
  const seatFrame = m4.make();
  function seatMatrix(out, model, pos, mood) {
    const middle = Math.atan2(-pos[0], -pos[2]);
    const toEye = Math.atan2(scene.eye[0] - pos[0], scene.eye[2] - pos[2]);
    let turn = toEye - middle;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    /* Whatever was moved by hand.
       `رسوم/_sources/majlis.blend` holds this room to scale, and a character
       shifted on its chair in there comes back as four numbers said in the
       seat's own frame: back from the table, along the rim, up, and turned.
       Said that way and not as a place in the room, because the room seats
       between two and five, and a chair is not always where it was. */
    const place = model.place;
    const scale = (place && place.scale) || FIGURE_SCALE;
    const reach = Math.hypot(pos[0], pos[2]) || 1;
    const outX = pos[0] / reach;
    const outZ = pos[2] / reach;
    const back = place ? place.back || 0 : 0;
    const along = place ? place.side || 0 : 0;
    const lift = place ? place.lift || 0 : 0;
    const extra = place ? place.turn || 0 : 0;
    const down = (mood && mood.fall) || 0;
    /* Arranged by hand, so nothing here is worked out again.
       `رسوم/_sources/majlis.blend` holds this room to scale. A body dropped
       onto its chair in there comes back as one matrix in the seat's own
       frame, and all that is left is to stand the seat where this table
       stands it. Said in the seat's frame and not the room's, because the
       room seats between two and five and a chair is not always where it
       was. */
    if (model.local) {
      m4.compose(seatFrame, [pos[0], -down * 0.04, pos[2]],
        middle, down * 0.26, 0, 1, 1, 1);
      return m4.multiply(out, seatFrame, model.local);
    }
    // Going out is mostly the clip's business now — the body slumps on its
    // own bones — so what is left here is the small forward tip of a person
    // giving up on the round, and not the whole fall the drawings needed.
    return m4.compose(out,
      [pos[0] + outX * back - outZ * along,
        CHAIR_TOP + lift - model.hip * scale - down * 0.04,
        pos[2] + outZ * back + outX * along],
      middle + extra + turn * 0.20, down * 0.26, 0, scale, scale, scale);
  }

  /** A point carried in one of a character's bones, brought out into the room.
   *  This is how a fan of cards is held rather than hovered: it is measured
   *  once against the hand and then rides every clip the hand is in. */
  const bonePoint = [0, 0, 0];
  function inHand(seat, out) {
    const mood = moods[seat];
    const model = scene.models[charOf(seat)];
    if (!mood || !mood.player || !model || !model.rigged || model.handNode < 0) {
      return null;
    }
    const bone = mood.player.world[model.handNode];
    if (!bone) return null;
    // The hand's place, stepped a little up and forward in the body's own
    // frame. Not the bone's frame: a glTF bone has no agreed idea which way
    // its own axes point, so the same three numbers land in front of one
    // exporter's palm and under another's. The cards face the player anyway,
    // so all that is asked of them is to travel with the hand.
    const o = model.handOffset;
    const x = bone[12] + o[0];
    const y = bone[13] + o[1];
    const z = bone[14] + o[2];
    const m = seatMatrix(scratchC, model, seatPosition(seat), mood);
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
  }

  function drawPerson(key, model, pos, mood, tint) {
    const gl = scene.gl;
    const prog = use(scene.prog.skin);
    seatMatrix(scene.model, model, pos, mood);
    U.m4(prog, 'uProj', scene.proj);
    U.m4(prog, 'uView', scene.view);
    U.m4(prog, 'uModel', scene.model);
    U.v4(prog, 'uBones', mood.bones);
    U.v4(prog, 'uWave', mood.wave);
    U.v2(prog, 'uShake', mood.shakeVec);
    U.f(prog, 'uGrey', mood.grey || 0);
    U.v3(prog, 'uRim', mood.rimVec || [0.20, 0.13, 0.07]);
    U.v4(prog, 'uTint', tint || [1, 1, 1, 1]);
    U.v3(prog, 'uSunDir', LIGHT.sun);
    U.v3(prog, 'uSunColor', LIGHT.sunColor);
    U.v3(prog, 'uAmbient', LIGHT.ambient);
    U.v3(prog, 'uFogColor', LIGHT.fogColor);
    U.v3(prog, 'uEye', scene.eye);
    U.v2(prog, 'uFog', LIGHT.fog);
    U.v3(prog, 'uLamp', LIGHT.lamp);
    U.v3(prog, 'uLampColor', LIGHT.lampColor);
    for (const part of model.parts) {
      attach(prog, part.mesh);
      U.tex(prog, 'uTex', part.tex || scene.tex['char-' + key]);
      gl.drawElements(gl.TRIANGLES, part.mesh.count, part.mesh.type, 0);
    }
  }

  /** How high the top of a seat's head is.
   *
   *  Nameplates and speech used to hang at one fixed height, which was the
   *  right height when every character was the same drawing cropped to the
   *  same box. People are not the same height, and a name floating a hand's
   *  width above a short one's hair is a name that belongs to nobody. */
  function headroom(seat) {
    const model = scene.models[charOf(seat)];
    if (!model || !model.rigged) return TABLE_Y + 0.98;
    if (model.top) return model.top + 0.28;
    return CHAIR_TOP + (model.tall - model.hip) * FIGURE_SCALE + 0.28;
  }

  function resize(width, height, dpr) {
    const gl = scene.gl;
    scene.width = width; scene.height = height; scene.dpr = dpr;
    scene.canvas.width = Math.max(1, Math.round(width * dpr));
    scene.canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, scene.canvas.width, scene.canvas.height);
    camera();
  }

  function camera() {
    const aspect = Math.max(0.3, scene.width / Math.max(1, scene.height));
    scene.wide = aspect > 1.15;
    const fov = scene.wide ? FOV_WIDE : FOV_TALL;
    scene.fov = fov;
    m4.perspective(scene.proj, fov, aspect, 0.04, 34);

    /* The hand is placed by how big a card should look, not by a distance.

       A fixed distance gives a card that fills two thirds of a laptop and a
       thumbnail on a phone, because the lens between them is not the same
       lens. So the size is the constant: a card is about a quarter of the
       height of the screen, and the distance that produces it is solved for. */
    /* Two sizes, not one. Resting, a card is a sixth of the height of the
       screen and sits low, because the room is what the player is reading.
       Raised, it is a quarter, because then the cards are what he is reading.
       The distance is solved for the raised size and the resting pose is
       scaled down from it, so both share one perspective. */
    const rise = Math.tan(fov / 2);
    const want = scene.wide ? 0.255 : 0.235;
    const dist = clamp(CARD_H / (2 * rise * want), 0.28, 2.4);
    scene.hand = {
      dist,
      span: rise * aspect * dist * 0.70,
      drop: rise * dist * 0.44,
      rest: 0.62,
    };

    // The head does not move; the view turns inside it. Yaw zero looks
    // across the table at the player opposite, which is where a person's eyes
    // rest when it is not their turn.
    const yaw = scene.baseYaw + orbit.yaw;
    const pitch = clamp(scene.basePitch + orbit.pitch, -1.45, 0.55);
    const flat = Math.cos(pitch);
    scene.eye = scene.base.slice();
    scene.at = [
      scene.eye[0] + Math.sin(yaw) * flat * 2.0,
      scene.eye[1] + Math.sin(pitch) * 2.0,
      scene.eye[2] - Math.cos(yaw) * flat * 2.0,
    ];
    m4.lookAt(scene.view, scene.eye, scene.at, [0, 1, 0]);
    m4.multiply(scene.vp, scene.proj, scene.view);
    // The camera's own placing in the world, so a card can be described the
    // way a hand holds it, a span in front of the eye, and land there exactly.
    let zx = scene.eye[0] - scene.at[0];
    let zy = scene.eye[1] - scene.at[1];
    let zz = scene.eye[2] - scene.at[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = zz, xy = 0, xz = -zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xz /= len;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    scene.axisX = [xx, xy, xz]; scene.axisY = [yx, yy, yz]; scene.axisZ = [zx, zy, zz];
    const cw = scene.camWorld;
    cw[0] = xx; cw[1] = xy; cw[2] = xz; cw[3] = 0;
    cw[4] = yx; cw[5] = yy; cw[6] = yz; cw[7] = 0;
    cw[8] = zx; cw[9] = zy; cw[10] = zz; cw[11] = 0;
    cw[12] = scene.eye[0]; cw[13] = scene.eye[1]; cw[14] = scene.eye[2]; cw[15] = 1;
  }

  /** Where a point in the world lands on the screen, in CSS pixels. Every
   *  nameplate and speech bubble rides on this: the words stay the browser's,
   *  so Arabic shapes and wraps correctly, but they follow the room. */
  const projected = [0, 0, 0, 0];
  function toScreen(x, y, z) {
    m4.project(projected, scene.vp, x, y, z);
    return {
      x: (projected[0] * 0.5 + 0.5) * scene.width,
      y: (0.5 - projected[1] * 0.5) * scene.height,
      w: projected[3],
    };
  }

  function seatPosition(index) {
    const angle = seatAngle(index, seatCount());
    return [Math.cos(angle) * SEAT_R, 0, Math.sin(angle) * SEAT_R];
  }

  /** The still parts of the majlis: floor, walls, ceiling, the table it is
   *  built around, the chairs behind the seats and the lanterns above. */
  function drawRoom(time) {
    const prog = use(scene.prog.world);
    lighting(prog);
    drawWorld(scene.mesh.floor, scene.tex.carpet, [0, 0, 0], 0, [1, 1, 1],
      { uv: [11, 11], tint: [0.90, 0.82, 0.78, 1] });
    drawWorld(scene.mesh.wall, scene.tex.wall, [0, 0, 0], 0, [1, 1, 1],
      { uv: [1, 1], tint: [0.98, 0.84, 0.72, 1] });
    // From above, the lantern's eye is over the roof: there is no ceiling.
    if (viewMode() !== 'top') {
      drawWorld(scene.mesh.ceiling, scene.tex.dark, [0, ROOM_H, 0], 0, [1, 1, 1],
        { tint: [0.34, 0.26, 0.24, 1] });
    }
    drawWorld(scene.mesh.pedestal, scene.tex.table, [0, 0, 0], 0, [1, 1, 1],
      { uv: [1, 1], tint: [0.82, 0.68, 0.56, 1], gloss: 0.10 });
    drawWorld(scene.mesh.table, scene.tex.table, [0, TABLE_Y + 0.001, 0], 0, [1, 1, 1],
      { gloss: 0.22 });

    /* The room itself: a chair behind every seat, sadu hung on the plaster,
       and the things a majlis keeps within reach — a dallah on its warmer and
       a pair of tall brass pots by the wall. None of it is reachable and none
       of it moves; it is there so the table is somewhere rather than nowhere. */
    /* A chair has a front. The model's back panel sits on its own negative
       z, so the yaw that turns that panel outwards is the one solved here,
       rather than the quarter turn that was there before and sat every
       character facing the wall.

       And it stands where the body is, not a third of a metre behind it. The
       old distance was right for drawings, which had no hips: a full person
       seated at the seat radius puts their weight at that radius, so the seat
       of the chair has to be under it. The back panel lands a hand's width
       behind the spine, which is what a chair does. */
    const chairs = seatCount();
    for (let seat = 0; seat < chairs; seat++) {
      const angle = seatAngle(seat, chairs);
      drawWorld(scene.mesh.chair, scene.tex.table,
        [Math.cos(angle) * CHAIR_R, 0, Math.sin(angle) * CHAIR_R],
        Math.atan2(-Math.cos(angle), -Math.sin(angle)), [1, 1, 1],
        { uv: [1, 1], tint: [0.66, 0.48, 0.34, 1], gloss: 0.12 });
    }

    for (const spot of [[2.35, 1.95], [-2.55, 1.75]]) {
      drawWorld(scene.mesh.pot, scene.tex.brass, [spot[0], 0, spot[1]], 0.4, [1, 1, 1],
        { uv: [1, 1], gloss: 0.6, tint: [0.92, 0.78, 0.52, 1] });
    }
    drawWorld(scene.mesh.dallah, scene.tex.brass, [0.62, TABLE_Y, -0.66], 0.9,
      [0.72, 0.72, 0.72], { uv: [1, 1], gloss: 0.8, tint: [1.18, 1.0, 0.7, 1] });
    for (let index = 0; index < 3; index++) {
      drawWorld(scene.mesh.cup, scene.tex.brass,
        [0.50 + index * 0.075, TABLE_Y, -0.50], 0, [1, 1, 1],
        { gloss: 0.6, tint: [1.05, 0.95, 0.78, 1] });
    }

    for (let index = 0; index < 4; index++) {
      const angle = index / 4 * Math.PI * 2 + 0.4;
      const at = [Math.cos(angle) * 2.75, 2.18 + Math.sin(time * 0.6 + index) * 0.012,
        Math.sin(angle) * 2.75];
      drawWorld(scene.mesh.dallah, scene.tex.brass, [at[0], at[1] - 0.16, at[2]],
        angle, [0.72, 0.72, 0.72], { uv: [1, 1], gloss: 0.5, tint: [1.1, 0.95, 0.7, 1] });
      scene.lanterns[index] = at;
    }
  }

  /** The soft parts: the lantern haloes and the shadows the figures and the
   *  cards drop. Blended, never written to depth, always last. */
  function drawGlows(time) {
    const gl = scene.gl;
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    // The lamp the table is lit by, seen rather than only felt.
    drawSprite(scene.tex.glow, LIGHT.lamp, [2.3, 2.3], [1, 0.84, 0.52, 0.42],
      Math.atan2(scene.eye[0] - LIGHT.lamp[0], scene.eye[2] - LIGHT.lamp[2]), 0);
    for (let index = 0; index < 4; index++) {
      const at = scene.lanterns[index];
      if (!at) continue;
      const pulse = 0.62 + Math.sin(time * 1.7 + index * 2.1) * 0.05;
      drawSprite(scene.tex.glow, at, [2.1, 2.1], [1, 0.80, 0.48, pulse * 0.62],
        Math.atan2(scene.eye[0] - at[0], scene.eye[2] - at[2]), 0);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
  }

  scene.lanterns = [null, null, null, null];

  // ═══════════════════════════ the table's own memory ═══════════════════════════
  /* The server sends a state; a table needs a story. Everything below is the
     difference between the two: what arrived, what was here before it, and
     the movement that carries one into the other. Nothing here decides a
     rule — a card only moves because the server already said it moved. */

  let words = {};                 // locales/ar.json
  let table = null;               // the last view from the server
  let room = null;
  let send = null;
  let root = null;
  const el = {};
  let running = false;
  let frame = 0;
  let started = 0;
  let skew = 0;                   // server clock minus ours
  let mute = false;
  let quality = 'balanced';
  let reduced = false;
  let talking = new Set();
  let pending = false;
  let errorAt = 0;

  const selected = new Set();     // indices into my hand
  let handCards = [];             // {face, index, lift, drag}
  // Down, the hand is tucked under the lip of the table where a hand rests.
  // Up, it is a single row held in front of the face. Touching the cards
  // raises it, touching the table lowers it, which is what hands do.
  let handUp = false;
  let handRaise = 0;
  // A hand you already hold while it is still being dealt is not a deal, it
  // is a screensaver. This counts the cards that have actually landed, and
  // the fan draws no more than that.
  let handShown = 0;
  let flights = [];               // cards in the air
  let pile = [];                  // cards resting in the middle
  let ceremony = null;            // the dallah and the six cups
  let callShow = null;            // the called card being shown round the table
  /* Stickers.

     They travel as ordinary room chat with a marker on the front, because the
     room already delivers chat to everybody in it, in order, without a new
     channel and without the server learning a new word. The table reads the
     marker, finds the seat it came from, and pops the drawing over that head.
  */
  const STICKER_MARK = '::st:';
  const STICKERS = '/telegram/stickers/';
  let stickerPack = null;
  let stickerSeen = 0;
  const turnRing = { angle: 0, seat: -1 };
  const moods = [];
  const bubbles = [];
  let shownRev = -1;
  let shownPhase = '';
  let shownLast = '';
  let shownRound = -1;
  const camNow = { eye: [0, EYE_Y, SEAT_R - 0.08], yaw: 0, pitch: -0.26, seat: -1 };

  const text = (path, args) => {
    let node = words;
    for (const part of String(path).split('.')) {
      if (!node || typeof node !== 'object') return '';
      node = node[part];
    }
    let out = typeof node === 'string' ? node : '';
    if (args) {
      for (const key of Object.keys(args)) {
        out = out.split('{' + key + '}').join(String(args[key]));
      }
    }
    return out;
  };

  const faceName = (face) => text('faces.' + face) || '';
  const charName = (key) => ((words.characters && words.characters[key]
    && words.characters[key].name) || key);
  const charOf = (seat) => (table && table.players[seat] && table.players[seat].char)
    || SEAT_CHAR[seat] || 'alaa';

  function pickLine(seat, kind) {
    const lines = (words.chatter && words.chatter[charOf(seat)]
      && words.chatter[charOf(seat)][kind]) || [];
    if (!lines.length) return null;
    const index = Math.floor(Math.random() * lines.length);
    return { text: lines[index], kind, index };
  }

  /** The character's own recording of that exact line, if it has been made.
   *
   *  Every sentence in the content file has a file reserved for it under
   *  `<sounds>/voices/<character>/<kind>-<n>.mp3`. Nothing is generated: a
   *  line that has not been recorded simply plays nothing, and the bubble
   *  carries it on its own until the day it does.
   */
  function playVoice(seat, kind, index) {
    if (mute) return;
    const url = stamp(ASSETS + '/sfx/voices/' + charOf(seat) + '/'
      + kind + '-' + (index + 1) + '.mp3');
    try {
      const clip = new Audio(url);
      clip.volume = 0.9;
      const promise = clip.play();
      if (promise && promise.catch) promise.catch(() => {});
    } catch (_) { /* not recorded yet, and that is a normal state */ }
  }

  // ═══════════════════════════ sound ═══════════════════════════

  const CLIPS = ['deal', 'flick', 'pick', 'throw', 'challenge', 'reveal', 'truth',
    'lie', 'pour', 'safe', 'bitter', 'win', 'lose', 'turn', 'tick', 'tap', 'sticker',
    'gift', 'royale', 'toll'];
  const audio = new Map();
  let audioReady = false;

  function loadAudio() {
    if (audioReady) return;
    audioReady = true;
    for (const name of CLIPS) {
      const pool = [];
      for (let i = 0; i < 2; i++) {
        const clip = new Audio(stamp(ASSETS + '/sfx/' + name + '.mp3'));
        clip.preload = 'auto';
        clip.volume = 0;
        pool.push(clip);
      }
      audio.set(name, { pool, at: 0 });
    }
  }

  function play(name, volume) {
    if (mute || !audioReady) return;
    const entry = audio.get(name);
    if (!entry) return;
    const clip = entry.pool[entry.at++ % entry.pool.length];
    try {
      clip.currentTime = 0;
      clip.volume = clamp(volume === undefined ? 0.7 : volume, 0, 1);
      const promise = clip.play();
      if (promise && promise.catch) promise.catch(() => {});
    } catch (_) { /* a phone that will not play yet */ }
  }

  // ═══════════════════════════ the figures' moods ═══════════════════════════

  function newMood() {
    return {
      breath: 0.006, sway: 0.004, lean: 0, grey: 0, shake: 0, shakeUntil: 0,
      fall: 0, fallAt: 0,
      leanTarget: 0, breathTarget: 0.006, greyTarget: 0, rim: 0.18,
      wave: new Float32Array(4), shakeVec: new Float32Array(2),
      rimVec: new Float32Array(3),
      // The skeleton's side of the same person: what it should be doing, what
      // it has just been told to do once, and the bones that come out of it.
      player: null, forKey: null, bones: null, wants: 'idle', fire: null,
      talkUntil: -99,
      // Being looked at: how long the camera has been pointed here, how far
      // the head has turned towards it, and when this one last had something
      // to say about it.
      stare: 0, look: 0, lookYaw: 0, saidAt: -99,
    };
  }

  for (let i = 0; i < 10; i++) moods.push(newMood());

  /** The royale's own announcements: the night opening, and each fall. */
  let royaleSaid = '';
  function royaleBanner(title, sub, sound) {
    const node = el.royaleBanner;
    if (!node) return;
    node.querySelector('b').textContent = title;
    node.querySelector('small').textContent = sub || '';
    node.hidden = false;
    node.classList.remove('is-on');
    void node.offsetWidth;
    node.classList.add('is-on');
    if (sound) play(sound, 0.9);
    window.clearTimeout(royaleBanner.timer);
    royaleBanner.timer = window.setTimeout(() => { node.hidden = true; }, 3400);
  }

  function royaleFall(seat) {
    const person = table && table.players[seat];
    if (!person) return;
    const left = table.players.filter((p) => p.alive).length;
    royaleBanner(text('royale.fallen', { name: person.name }), text('royale.left', { n: left }), 'toll');
  }

  function paintRoyale() {
    if (!table || table.mode !== 'royale') return;
    const key = table.round + ':' + table.phase;
    if (table.round === 1 && table.phase === 'deal' && royaleSaid !== key) {
      royaleSaid = key;
      royaleBanner(text('royale.banner'), text('royale.sub'), 'royale');
    }
  }

  function bump(seat, kind) {
    const mood = moods[seat];
    if (!mood) return;
    if (kind === 'throw') { mood.lean = 0.085; mood.breathTarget = 0.010; }
    if (kind === 'challenge') {
      mood.lean = 0.13; mood.shake = 0.016; mood.shakeUntil = frame + 0.55;
    }
    if (kind === 'caught') { mood.shake = 0.012; mood.shakeUntil = frame + 0.7; }
    if (kind === 'safe') { mood.lean = -0.03; mood.breathTarget = 0.012; }
    if (kind === 'out') {
      if (table && table.mode === 'royale') royaleFall(seat);
      mood.greyTarget = 1;
      mood.leanTarget = -0.05;
      mood.breathTarget = 0.002;
      mood.fallAt = frame;          // the moment he goes down on the table
    }
    // And the same moment, said with the body. Kept as a note rather than
    // played here: the models arrive over the network and the first throw of
    // a round can easily beat them to it.
    if (CLIP_FOR[kind]) mood.fire = CLIP_FOR[kind];
  }

  /* How narrow a stare has to be before a character feels it, how long it has
     to be held, and how much of the way round the head goes. A head that
     snapped the whole way would look like a shop dummy on a turntable. */
  const GAZE_CONE = 0.30;          // radians off the middle of the view
  const GAZE_HOLD = 1.25;          // seconds of being stared at
  const GAZE_TURN = 0.86;          // how far towards you the head comes
  const GAZE_SAY = 9.0;            // seconds before the same seat speaks again

  /** Who the camera is pointed at, if anybody.
   *
   *  The camera's own forward, against the direction of each head. Nearest
   *  inside the cone wins, so leaning between two people picks one of them
   *  rather than making both of them turn round. */
  function staredAt() {
    if (!table || table.phase === 'setup' || table.phase === 'done') return -1;
    const cw = scene.camWorld;
    const fx = -cw[8], fy = -cw[9], fz = -cw[10];
    let best = -1;
    let tight = GAZE_CONE;
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === mySeat()) continue;
      const person = table.players[seat];
      if (!person || !person.alive || !person.bot) continue;
      const at = seatPosition(seat);
      const dx = at[0] - scene.eye[0];
      const dy = headroom(seat) - 0.30 - scene.eye[1];
      const dz = at[2] - scene.eye[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const dot = (fx * dx + fy * dy + fz * dz) / len;
      const off = Math.acos(clamp(dot, -1, 1));
      if (off < tight) { tight = off; best = seat; }
    }
    return best;
  }

  /** The heads, and what a caught stare is worth saying about.
   *
   *  A character who has been looked at long enough turns their face to the
   *  camera and, once in a while, says so. The words are the character's own
   *  and live in the content file, so a line can be changed without touching
   *  a line of this. */
  function stepGaze(dt) {
    const on = staredAt();
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === mySeat()) continue;
      const mood = moods[seat];
      if (!mood) continue;
      const person = table && table.players[seat];
      /* A person at the other end of the room turns his own head.
         The stare belongs to the table's characters and to them only: it was
         written for a majlis of three bots, where looking at one of them long
         enough was the only way to be noticed. Pointed at a real player it
         was a puppet show — his face swinging round to me while he sat
         looking somewhere else entirely, and his own words put in his mouth.
         So his head follows his camera instead, the angle he sends out with
         every turn of his own screen. */
      if (person && !person.bot) {
        const want = clamp(-Number(person.look || 0) * 0.92, -1.15, 1.15);
        mood.lookYaw += (want - mood.lookYaw) * clamp(dt * 5.5, 0, 1);
        mood.look += (1 - mood.look) * clamp(dt * 4.5, 0, 1);
        mood.stare = 0;
        continue;
      }
      const met = seat === on && person && person.alive;
      mood.stare = met ? mood.stare + dt : 0;
      const want = mood.stare > GAZE_HOLD ? 1 : 0;
      // Slowly towards you and slowly away again: the turn is the whole of
      // the effect, and a fast one reads as a flinch.
      mood.look += (want - mood.look) * clamp(dt * (want ? 2.4 : 1.5), 0, 1);
      if (mood.look > 0.004) {
        const at = seatPosition(seat);
        const middle = Math.atan2(-at[0], -at[2]);
        const toEye = Math.atan2(scene.eye[0] - at[0], scene.eye[2] - at[2]);
        let turn = toEye - middle;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        mood.lookYaw = clamp(turn * GAZE_TURN, -1.15, 1.15);
      }
      if (want && frame - mood.saidAt > GAZE_SAY
          && mood.stare > GAZE_HOLD + 0.55 && frame > mood.talkUntil) {
        mood.saidAt = frame;
        sayGaze(seat);
      }
    }
  }

  function sayGaze(seat) {
    const lines = (words.gaze && words.gaze[charOf(seat)]) || [];
    if (!lines.length) return;
    const line = lines[Math.floor(Math.random() * lines.length)];
    if (!line) return;
    bubbles[seat] = { text: line, until: frame + 2.6 };
    if (moods[seat]) moods[seat].talkUntil = frame + 2.4;
    const node = el.says && el.says[seat];
    if (node) showBubble(node, line);
  }

  function stepMoods(dt) {
    for (let seat = 0; seat < seatCount(); seat++) {
      const mood = moods[seat];
      const person = table && table.players[seat];
      const mine = table && table.turn === seat && table.phase === 'playing';
      mood.leanTarget = person && !person.alive ? -0.05 : (mine ? 0.032 : 0);
      mood.breathTarget = person && !person.alive ? 0.002
        : (talking.has(person && person.id) ? 0.015 : (mine ? 0.009 : 0.006));
      mood.greyTarget = person && !person.alive ? 1 : 0;
      const rate = clamp(dt * 4.2, 0, 1);
      mood.lean += (mood.leanTarget - mood.lean) * rate;
      mood.breath += (mood.breathTarget - mood.breath) * rate;
      mood.grey += (mood.greyTarget - mood.grey) * clamp(dt * 1.6, 0, 1);
      /* Falling forward. Not a fade and not a slump in place: a man who has
         drunk the bitter cup puts his head on the table, and the model's
         origin is at his feet, so one rotation about it does the whole
         thing — the head swings out over the wood and the shoulders drop
         after it. It settles a little short of flat and stays there. */
      const down = person && !person.alive && mood.fallAt
        ? easeOut(clamp((frame - mood.fallAt) / 1.1, 0, 1)) : 0;
      mood.fall += (down - mood.fall) * clamp(dt * 3.2, 0, 1);
      if (frame > mood.shakeUntil) mood.shake += (0 - mood.shake) * rate;
      const still = reduced ? 0.25 : 1;
      mood.wave[0] = mood.breath * still;
      mood.wave[1] = mood.sway * still;
      mood.wave[2] = mood.lean;
      mood.wave[3] = frame + seat * 1.7;
      mood.shakeVec[0] = mood.shake;
      mood.shakeVec[1] = 34;
      const warm = mine ? 0.34 : 0.16;
      mood.rimVec[0] = warm; mood.rimVec[1] = warm * 0.66; mood.rimVec[2] = warm * 0.34;

      /* And the skeleton, for whoever has one. The clip is decided here and
         not at the draw: a frame can skip a figure that is behind the player's
         own head, and a person who stops moving when nobody is looking at them
         is a person who jumps when they are looked at again. */
      const key = charOf(seat);
      const model = scene.models[key];
      if (!model || !model.rigged) { mood.player = null; mood.bones = null; continue; }
      if (!mood.player || mood.forKey !== key) {
        mood.player = newPlayer(model);
        mood.forKey = key;
        mood.bones = mood.player.bones;
      }
      const speaking = talking.has(person && person.id) || frame < mood.talkUntil;
      mood.wants = person && !person.alive ? 'out' : (speaking ? 'talk' : 'idle');
      if (mood.fire) {
        playClip(mood.player, model, mood.fire, mood.fire !== 'out');
        mood.fire = null;
      }
      stepPlayer(mood.player, model, mood, reduced ? dt * 0.5 : dt);
    }
  }

  // ═══════════════════════════ cards in the world ═══════════════════════════

  const scratch = m4.make();
  const scratchB = m4.make();
  const scratchC = m4.make();

  function restingSpot(order) {
    const rng = seeded(1013 + order * 7717 + (table ? table.round * 131 : 0));
    const angle = rng() * Math.PI * 2;
    const radius = 0.05 + rng() * 0.10;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y: TABLE_Y + 0.004 + order * 0.0022,
      spin: (rng() - 0.5) * 0.9,
    };
  }

  /** A card lying on the table: flat, turned a little, face down unless the
   *  challenge turned it over. */
  function drawPileCard(card, index) {
    const lifted = card.reveal ? card.reveal.lift : 0;
    const turn = card.reveal ? card.reveal.turn : 0;
    const x = card.x + (card.reveal ? card.reveal.x : 0);
    const z = card.z + (card.reveal ? card.reveal.z : 0);
    // A face down card shows its back and a turned one its face: the flip is
    // a real half turn about the card's own long axis, not a swap of pictures.
    m4.compose(scratch, [x, card.y + lifted, z], card.spin,
      -Math.PI / 2 + turn * 0.62, Math.PI * turn, CARD_W, CARD_H, 1);
    drawCard(scratch, turn > 0.5 ? card.face : 'back', null);
    void index;
  }

  /** The fan an opponent holds: backs only, angled towards the middle. */
  const held = [0, 0, 0];
  function drawSeatHand(seat, count) {
    if (count <= 0) return;
    const at = seatPosition(seat);
    // Held in the left hand when there is a left hand to hold it, and in
    // front of the chest when there is not, which is where the drawings kept
    // theirs and where a model without a skeleton still keeps them.
    const chest = inHand(seat, held)
      || [at[0] * 0.70, TABLE_Y + 0.125, at[2] * 0.70];
    const spread = Math.min(0.20, 0.62 / Math.max(1, count));
    for (let i = 0; i < count; i++) {
      const a = (i - (count - 1) / 2) * spread;
      const yaw = Math.atan2(scene.eye[0] - chest[0], scene.eye[2] - chest[2]);
      const px = chest[0] + Math.cos(yaw) * Math.sin(a) * 0.10;
      const pz = chest[2] - Math.sin(yaw) * Math.sin(a) * 0.10;
      m4.compose(scratch, [px, chest[1] + Math.cos(a) * 0.02, pz],
        yaw, -0.34, -a * 0.9, CARD_W * 0.60, CARD_H * 0.60, 1);
      drawCard(scratch, 'back', null);
    }
  }

  /** My own hand, described where a hand actually is: a span in front of the
   *  eye. It is placed in the camera's own frame and then carried into the
   *  world, so it holds its shape whatever the camera is doing. */
  function handMatrix(out, index, count, lift, drag) {
    const held = scene.hand;
    const raise = handRaise;
    const middle = index - (count - 1) / 2;

    // Resting: a small shallow fan, tucked low and tipped away, only the top
    // edges of the cards showing above the lip of the table.
    const restAngle = middle * Math.min(0.15, 0.58 / Math.max(1, count));
    const restX = Math.sin(restAngle) * held.span * 0.50;
    const restY = -held.drop * 1.46;
    const restZ = -held.dist * 1.10;
    const restPitch = 0.72;
    const restRoll = -restAngle * 0.75;

    // Raised: one row, evenly spaced, square to the eye and readable. The
    // row is as wide as the frame allows, so the cards overlap only as much
    // as they must and never hide the corner that names them.
    const step = Math.min(CARD_W * 1.04, held.span * 1.9 / Math.max(1, count));
    const rowX = middle * step;
    const rowY = -held.drop * 0.62;
    const rowZ = -held.dist;

    const x = mix(restX, rowX, raise);
    const y = mix(restY, rowY, raise) + lift * held.dist * 0.13
      + (drag ? drag.y : 0) * held.dist;
    // Every card gets its own depth. Overlapping cards at one depth is what
    // made the hand crawl with flicker: two surfaces at the same distance
    // from the eye, and the depth buffer flipping a coin every frame over
    // which one is in front.
    const z = mix(restZ, rowZ, raise) + index * 0.0022
      + lift * held.dist * 0.05 + (drag ? drag.z : 0) * held.dist;

    // While they are still arriving they are held a little closer than
    // life, the way you look at a hand you have not seen yet.
    const boost = table && table.phase === 'deal' ? 1.2 : 1;
    const size = mix(held.rest, boost, raise);
    m4.compose(scratchB, [x, y, z], (drag ? drag.yaw : 0),
      mix(restPitch, 0.05, raise) - lift * 0.08,
      mix(restRoll, 0, raise), CARD_W * size, CARD_H * size, 1);
    m4.multiply(out, scene.camWorld, scratchB);
    return out;
  }

  function drawHand() {
    if (!table || !table.hand || !table.hand.length) return;
    const count = table.hand.length;
    const arrived = Math.min(count, handShown);
    for (let index = 0; index < arrived; index++) {
      const card = handCards[index] || { lift: 0 };
      handMatrix(scratch, index, count, card.lift, card.drag);
      const dim = table.canPlay ? 1 : 0.72;
      drawCard(scratch, table.hand[index], [dim, dim, dim, 1]);
    }
  }

  function drawFlights() {
    for (const flight of flights) {
      if (frame < flight.at) continue;
      const t = clamp((frame - flight.at) / flight.dur, 0, 1);
      // Out fast, in slow. A card thrown across a table leaves quickly and
      // settles; a card that eases at both ends floats like paper in a lift.
      const ease = 1 - Math.pow(1 - t, 2.2);
      // My own cards are aimed at where my hand is now, not where it was when
      // the deal started: the camera moves during the ceremony, and a card
      // that lands where the hand used to be lands in mid air.
      const to = (flight.kind === 'deal' && flight.seat === mySeat())
        ? handOrigin(mySeat()) : flight.to;
      const x = mix(flight.from[0], to[0], ease);
      const z = mix(flight.from[2], to[2], ease);
      const y = mix(flight.from[1], to[1], ease)
        + Math.sin(t * Math.PI) * (flight.arc === undefined ? 0.30 : flight.arc);
      const spin = mix(flight.spin0, flight.spin1, ease);
      // It arrives flat rather than mid tumble: the turn is spent by the time
      // it lands, so nothing snaps into place at the end.
      const tilt = mix(0, flight.kind === 'deal' ? -1.25 : -Math.PI / 2, easeOut(t));
      const roll = (1 - ease) * Math.PI * 2.0 * flight.roll;
      m4.compose(scratch, [x, y, z], spin, tilt, roll, CARD_W, CARD_H, 1);
      drawCard(scratch, flight.face || 'back', null);
    }
  }

  // ═══════════════════════════ the dallah and the six cups ═══════════════════════════

  function cupSpot(index, total) {
    const a = -0.62 + index / Math.max(1, total - 1) * 1.24;
    return [Math.sin(a) * 0.165, 0, 0.03 + Math.cos(a) * 0.165 - 0.165];
  }

  /** The called card, standing in the middle and turning to every seat. */
  function drawCall() {
    if (!callShow) return;
    const t = frame - callShow.at;
    if (t > 6.4) { callShow = null; return; }
    const rise = easeOut(clamp(t / 0.8, 0, 1));
    const fold = clamp((t - 5.2) / 0.95, 0, 1);
    if (fold >= 1) { callShow = null; return; }

    // Up, round once slowly enough that everybody at the table has actually
    // read it, held a beat facing the player, and away to the corner where
    // the round's call stays written down.
    const spin = clamp((t - 0.9) / 3.5, 0, 1);
    const yaw = Math.atan2(scene.eye[0], scene.eye[2]) + easeInOut(spin) * Math.PI * 2;
    const lift = TABLE_Y + 0.10 + rise * 0.34 + fold * 0.30;
    const size = (1.9 - fold * 1.5) * rise;
    m4.compose(scratch, [0, lift, 0], yaw, 0, 0,
      CARD_W * size, CARD_H * size, 1);
    const fade = 1 - fold;
    lighting(use(scene.prog.card));
    drawCard(scratch, callShow.face, [fade, fade, fade, fade]);
  }

  /** The ring on the wood, and the bright arc of it that faces whoever is
   *  playing. It is the table's own way of saying whose turn it is, without a
   *  word and without covering a card. */
  function drawTurnRing(dt) {
    if (!table || table.phase === 'done' || table.phase === 'setup') return;
    const seat = clamp(table.turn, 0, seatCount() - 1);
    const want = -seatAngle(seat, seatCount());
    if (turnRing.seat !== seat) {
      // Always the short way round, so the arc never takes the long way to
      // the player sitting next to the last one.
      let step = want - turnRing.angle;
      while (step > Math.PI) step -= Math.PI * 2;
      while (step < -Math.PI) step += Math.PI * 2;
      turnRing.target = turnRing.angle + step;
      turnRing.seat = seat;
    }
    turnRing.angle += ((turnRing.target || want) - turnRing.angle)
      * clamp(dt * 4.5, 0, 1);

    const gl = scene.gl;
    gl.depthMask(false);
    const mine = table.seat !== null && seat === table.seat;
    const pulse = 0.55 + Math.sin(frame * 2.4) * 0.10;
    const prog = use(scene.prog.sprite);
    U.m4(prog, 'uProj', scene.proj);
    U.m4(prog, 'uView', scene.view);

    attach(prog, scene.mesh.ring);
    m4.compose(scene.model, [0, TABLE_Y + 0.004, 0], 0, 0, 0, 1, 1, 1);
    U.m4(prog, 'uModel', scene.model);
    U.v4(prog, 'uTint', [0.98, 0.84, 0.56, 0.34]);
    U.tex(prog, 'uTex', scene.tex.glow);
    gl.drawElements(gl.TRIANGLES, scene.mesh.ring.count, scene.mesh.ring.type, 0);

    attach(prog, scene.mesh.arc);
    m4.compose(scene.model, [0, TABLE_Y + 0.005, 0], turnRing.angle, 0, 0, 1, 1, 1);
    U.m4(prog, 'uModel', scene.model);
    U.v4(prog, 'uTint', mine
      ? [0.62, 1.25, 0.86, 0.55 + pulse * 0.9]
      : [1.25, 0.98, 0.52, 0.42 + pulse * 0.75]);
    U.tex(prog, 'uTex', scene.tex.glow);
    gl.drawElements(gl.TRIANGLES, scene.mesh.arc.count, scene.mesh.arc.type, 0);
    gl.depthMask(true);
  }

  /* The cup, staged.

     Six cups are set out. The dallah comes in and hunts along the row,
     hesitating over one and then another, before it settles — it settles on
     the cup the server chose before any of this was drawn, but nobody
     watching knows that, and the hesitation is the whole point. Then a slow
     pour, the cup carried up to the face, and a held silence with nothing
     moving at all. Only after that does anyone learn anything.

     The beats:
        0.0  the tray rises, the drunk cups lying on their sides
        1.0  the dallah arrives and starts hunting
        2.6  it settles over one cup
        3.2  the pour, slow
        4.9  the cup is lifted to the face
        5.8  everything stops
        6.7  the taste
  */
  const CUP_SET = 1.0;
  const CUP_HUNT = 2.6;
  const CUP_SETTLE = 3.2;
  const CUP_POUR = 4.9;
  const CUP_LIFT = 5.8;

  function drawCeremony() {
    if (!ceremony) return;
    const t = frame - ceremony.at;
    const lift = easeOut(clamp(t / 0.7, 0, 1));
    const base = [0, TABLE_Y + 0.010 - (1 - lift) * 0.28, 0];
    const total = ceremony.total;
    const spot = cupSpot(ceremony.index, total);
    const told = t >= ceremony.sip;
    const after = clamp((t - ceremony.sip) / 0.5, 0, 1);
    const prog = use(scene.prog.world);
    lighting(prog);
    drawWorld(scene.mesh.tray, scene.tex.brass, base, 0, [1, lift, 1],
      { uv: [3, 1], gloss: 0.75, tint: [1.16, 1.0, 0.72, 1] });

    // Where the dallah is. It hunts along the row first, and only leans on
    // one cup once it has looked at three.
    let hoverX = spot[0];
    if (t < CUP_SETTLE) {
      const hunt = clamp((t - CUP_SET) / (CUP_HUNT - CUP_SET), 0, 1);
      const sweep = Math.sin(hunt * Math.PI * 2.6) * 0.19;
      const settle = easeInOut(clamp((t - CUP_HUNT) / (CUP_SETTLE - CUP_HUNT), 0, 1));
      hoverX = mix(sweep, spot[0], settle);
    }

    const raise = easeOut(clamp((t - CUP_POUR) / 0.85, 0, 1));
    const fill = clamp((t - CUP_SETTLE) / (CUP_POUR - CUP_SETTLE - 0.1), 0, 1);

    for (let index = 0; index < total; index++) {
      const seat = cupSpot(index, total);
      const drunk = index < ceremony.index;
      const active = index === ceremony.index;
      // The cup being hunted over lifts a hair, the way a thing does when it
      // is about to be picked.
      const near = !drunk && !active && t > CUP_SET && t < CUP_SETTLE
        ? Math.max(0, 1 - Math.abs(seat[0] - hoverX) * 14) * 0.012 : 0;
      const bad = told && ceremony.bitter && active;
      const tint = drunk ? [0.58, 0.50, 0.42, 1]
        : (bad ? [0.48, 0.30, 0.24, 1] : [1.12, 1.0, 0.80, 1]);
      drawWorld(scene.mesh.cup, scene.tex.brass,
        [base[0] + seat[0], base[1] + 0.012 + near + (active ? raise * 0.17 : 0),
          base[2] + seat[2]],
        0, [1, 1, 1],
        { pitch: drunk ? 1.25 : (active ? raise * 0.72 : 0), gloss: 0.62, tint });
      if (active && fill > 0.02) {
        drawWorld(scene.mesh.cup, scene.tex.white,
          [base[0] + seat[0], base[1] + 0.030 + raise * 0.17, base[2] + seat[2]],
          0, [0.72, 0.02 + fill * 0.30, 0.72],
          { pitch: raise * 0.72,
            tint: bad ? [0.13, 0.06, 0.04, 1] : [0.30, 0.16, 0.08, 1] });
      }
    }

    // The dallah itself: in, hunting, tipped, and away once the cup is full.
    const arrive = easeOut(clamp((t - 0.35) / 0.65, 0, 1));
    const leave = clamp((t - CUP_POUR + 0.5) / 0.7, 0, 1);
    const tip = Math.sin(clamp((t - CUP_SETTLE) / (CUP_POUR - CUP_SETTLE), 0, 1)
      * Math.PI) * 0.95;
    const height = 0.26 + (1 - arrive) * 0.55 + leave * 0.6;
    const sway = t < CUP_SETTLE ? Math.sin(t * 5.5) * 0.05 : 0;
    if (leave < 0.98) {
      /* Tipped towards the cup and not away from it.
         A pot is a body of revolution: it has no spout of its own, so the
         side it pours from is decided entirely by which way it is tipped, and
         the tip happens about the axis the yaw has already turned. Yawed one
         way and offset the other, it stood beside the cup and emptied itself
         onto the tray. Standing to one side and turned to face the cup, the
         mouth comes over the cup and the coffee falls where it is looked at.
         The stand is on -x, so the pot faces +x: a quarter turn. */
      const stand = 0.20;
      drawWorld(scene.mesh.dallah, scene.tex.brass,
        [base[0] + hoverX - stand, base[1] + height, base[2] + spot[2] - 0.02],
        Math.PI / 2 + sway, [1, 1, 1],
        { pitch: tip, gloss: 0.85, tint: [1.25, 1.06, 0.76, 1] });
      if (tip > 0.28) {
        // The thread of coffee, from the lip of the pot down into the cup it
        // is aimed at. Leaning with the pot rather than hanging straight, so
        // it reads as poured and not as dripped.
        const mouth = hoverX - stand + Math.sin(tip) * 0.30;
        drawWorld(scene.mesh.cup, scene.tex.white,
          [base[0] + (mouth + spot[0]) * 0.5, base[1] + 0.06,
            base[2] + spot[2] - 0.005],
          0, [0.09, (height - 0.05) * 14, 0.09], { tint: [0.42, 0.25, 0.10, 0.88] });
      }
    }

    // And the verdict, written in light: gold for a sweet cup, a dark red
    // wash for the bitter one.
    if (told && after > 0.01) {
      const glow = Math.sin(clamp(after, 0, 1) * Math.PI) * 0.7;
      drawSprite(scene.tex.glow, [base[0] + spot[0], base[1] + 0.28, base[2] + spot[2]],
        [0.9, 0.9], ceremony.bitter
          ? [1.0, 0.22, 0.16, glow] : [1.0, 0.86, 0.5, glow],
        Math.atan2(scene.eye[0], scene.eye[2]), 0);
    }
  }

  // ═══════════════════════════ the frame ═══════════════════════════

  /* Telling the table where I am looking.

     My own head is the one thing about me the others cannot see: they are
     looking at a character sitting in my chair, and until now it faced the
     middle of the table however much I turned. So the angle goes out — not
     every frame, which would be two hundred messages a minute for nothing,
     but when it has actually moved and no oftener than twice a second. It
     goes out under the table's own quiet channel: no reply is read, no
     button is greyed while it travels, and a dropped one costs a shrug. */
  let saidLook = 0;
  let saidLookAt = -99;
  function tellLook() {
    if (!send || !table || table.seat === null || table.seat === undefined) return;
    if (table.phase === 'setup' || table.phase === 'done') return;
    if (Math.abs(orbit.yaw - saidLook) < 0.05 || frame - saidLookAt < 0.45) return;
    saidLook = orbit.yaw;
    saidLookAt = frame;
    try {
      const out = send('look', { yaw: Math.round(orbit.yaw * 1000) / 1000 });
      if (out && out.catch) out.catch(() => {});
    } catch (_) { /* a look is not worth a word */ }
  }

  /** Where the round wants the player to be looking, and how far he is
   *  leaning in. Never where he is sitting: the chair does not move. */
  /* Where the round would like the head to be.

     Almost nowhere. The camera belongs to the player: it is how he decides
     who to watch, and a game that keeps taking it back is a game that watches
     itself. So the seat never moves and the aim never moves — the one
     exception is a single nudge back to centre when the call goes up, and
     even that lets go the moment he touches the screen.

     The cup used to pull the head round to the loser. It does not any more:
     he is watching, not being marched. */
  /** The eye of whoever is holding this phone: his own chair, drawn in a
   *  hand's width from the back of it. */
  function eyeSpot(back) {
    const angle = seatAngle(mySeat(), seatCount());
    const reach = SEAT_R - (back === undefined ? 0.08 : back);
    return [Math.cos(angle) * reach, EYE_Y, Math.sin(angle) * reach];
  }

  /** The yaw at which he is looking across the table rather than along it.
   *
   *  Yaw zero has to mean the same thing in every chair — the middle of the
   *  table — or a player in the third chair would open the round staring at
   *  a wall, and every angle the game speaks in would be wrong for him. */
  function homeYaw() {
    return seatAngle(mySeat(), seatCount()) - Math.PI / 2;
  }

  function cameraTarget() {
    const phase = table ? table.phase : 'playing';
    const yaw = homeYaw();
    const mode = viewMode();
    if (mode !== 'first') {
      const angle = seatAngle(mySeat(), seatCount());
      const wide = seatCount() > 6 ? 1.35 : 1;
      if (mode === 'top') {
        // From under the lanterns, a little towards his own chair, so the
        // table reads the right way up and nobody's face is a bald spot.
        const reach = 1.25 * wide;
        const tall = scene.width > scene.height ? 0 : 0.9;
        return { eye: [Math.cos(angle) * reach, 3.6 + tall + (wide - 1) * 2.2, Math.sin(angle) * reach],
          yaw, pitch: -1.2 };
      }
      // Over his own shoulder: close enough to be him, far enough to see
      // himself sitting there with the others.
      const reach = SEAT_R * wide + 1.7;
      return { eye: [Math.cos(angle) * reach, 2.45 + (wide - 1) * 0.5, Math.sin(angle) * reach],
        yaw, pitch: phase === 'reveal' ? -0.62 : -0.54 };
    }
    const seated = eyeSpot();
    if (phase === 'reveal') {
      // A small lean over the middle when a claim is turned. No turn in it,
      // so it costs the player nothing he chose.
      const over = eyeSpot(0.18);
      over[1] = EYE_Y - 0.05;
      return { eye: over, yaw, pitch: -0.34 };
    }
    if (phase === 'done') return { eye: seated, yaw, pitch: -0.18 };
    return { eye: seated, yaw, pitch: -0.26 };
  }

  function stepCamera(dt) {
    const want = cameraTarget();
    // Changing chairs is not a camera move, it is a different person. When
    // the seat the server gave us changes — which happens once, as the table
    // opens — the eye is put there rather than flown there.
    if (camNow.seat !== mySeat()) {
      camNow.seat = mySeat();
      camNow.eye = want.eye.slice();
      camNow.yaw = want.yaw;
      camNow.pitch = want.pitch;
    }
    const rate = clamp(dt * 1.9, 0, 1);
    for (let i = 0; i < 3; i++) {
      camNow.eye[i] += (want.eye[i] - camNow.eye[i]) * rate;
      scene.base[i] = camNow.eye[i];
    }
    let spin = want.yaw - camNow.yaw;
    while (spin > Math.PI) spin -= Math.PI * 2;
    while (spin < -Math.PI) spin += Math.PI * 2;
    camNow.yaw += spin * rate;
    camNow.pitch += (want.pitch - camNow.pitch) * rate;
    scene.baseYaw = camNow.yaw;
    scene.basePitch = camNow.pitch;

    // One nudge, once, when a round opens: the call is held up in the middle
    // and everybody has to have seen it. It runs for under a second and any
    // touch of the screen cancels it on the spot.
    if (orbit.snapUntil > frame && orbit.touched < orbit.snapAt) {
      const back = clamp(dt * 3.4, 0, 1);
      orbit.yaw += (0 - orbit.yaw) * back;
      orbit.pitch += (0 - orbit.pitch) * back;
      if (el.recenter && Math.abs(orbit.yaw) < 0.05) el.recenter.hidden = true;
    }

    tellLook();
    // The head is never turned for the player. He asked for that expressly,
    // and he was right: a camera that swings on its own takes the one thing
    // this game is about — deciding who to look at — out of his hands. The
    // ring on the table says whose turn it is; the looking stays his.
    camera();
  }

  function stepFlights() {
    if (!flights.length) return;
    const rest = [];
    for (const flight of flights) {
      if (frame - flight.at < flight.dur) { rest.push(flight); continue; }
      if (flight.kind === 'deal') {
        // It has arrived. If it is mine it becomes a card in the fan, and the
        // sound is the one a card makes touching another card, not a shuffle.
        if (flight.seat === mySeat()) handShown += 1;
        play('flick', 0.16 + (flight.slot || 0) * 0.01);
        continue;
      }
      // A dealt card lands in a hand and is gone; only a thrown one stays.
      if (flight.kind !== 'pile') continue;
      pile.push({
        x: flight.to[0], y: flight.to[1], z: flight.to[2],
        spin: flight.spin1, face: flight.face, reveal: null,
      });
      play('flick', 0.35);
    }
    flights = rest;
  }

  function stepReveal(dt) {
    if (!table || !table.reveal) return;
    // Only while the claim is being read. The moment the cup is poured the
    // cards lie flat again and the middle of the table is the tray's: a card
    // standing on end in front of the dallah hides the one thing everybody at
    // the table is waiting to see.
    const shown = table.phase === 'reveal';
    const count = table.reveal.count || 0;
    const start = Math.max(0, pile.length - count);
    for (let index = 0; index < pile.length; index++) {
      const card = pile[index];
      const inSet = shown && index >= start;
      if (inSet && !card.reveal) {
        card.reveal = { turn: 0, lift: 0, x: 0, z: 0 };
        card.face = table.reveal.cards[index - start] || card.face;
      }
      if (!card.reveal) continue;
      const slot = index - start;
      const wantTurn = inSet ? 1 : 0;
      const rate = clamp(dt * 2.6, 0, 1);
      card.reveal.turn += (wantTurn - card.reveal.turn) * rate;
      card.reveal.lift += ((inSet ? 0.16 + slot * 0.004 : 0) - card.reveal.lift) * rate;
      const spread = (slot - (count - 1) / 2) * 0.24;
      card.reveal.x += ((inSet ? spread - card.x : 0) - card.reveal.x) * rate;
      card.reveal.z += ((inSet ? 0.14 - card.z : 0) - card.reveal.z) * rate;
      if (inSet) card.spin += (0 - card.spin) * rate;
    }
  }

  function render(now) {
    if (!running) return;
    const seconds = now / 1000;
    const dt = Math.min(0.05, seconds - (frame || seconds));
    frame = seconds;
    if (!scene.ready || scene.lost) { requestAnimationFrame(render); return; }
    const gl = scene.gl;

    stepCamera(dt);
    stepAtmosphere(dt);
    stepGaze(dt);
    stepMoods(dt);
    stepFlights();
    stepReveal(dt);
    stepHand(dt);
    stepBubbles();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    drawRoom(frame);
    drawCeremony();
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    drawTurnRing(dt);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // Shadows first, flat on the wood and the floor, so the cards and the
    // people that follow have something to stand on.
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === selfSeat()) continue;
      const person = table && table.players[seat];
      if (!person) continue;
      const at = seatPosition(seat);
      drawSprite(scene.tex.shadow, [at[0], 0.012, at[2]], [0.92, 0.62],
        [0, 0, 0, person.alive ? 0.55 : 0.3]);
    }
    if (pile.length) {
      drawSprite(scene.tex.shadow, [0, TABLE_Y + 0.003, 0.02], [0.62, 0.42], [0, 0, 0, 0.35]);
    }
    gl.depthMask(true);

    // The cards on the table, then the people, then my own hand nearest the
    // eye. Drawing order is depth order, which is why nothing needs sorting.
    gl.disable(gl.CULL_FACE);
    lighting(use(scene.prog.card));
    for (let index = 0; index < pile.length; index++) drawPileCard(pile[index], index);
    drawFlights();
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === selfSeat()) continue;
      const person = table && table.players[seat];
      if (person) drawSeatHand(seat, person.cards);
    }

    // Farthest first, so a nearer neighbour is drawn over a distant one.
    const order = [];
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat !== selfSeat()) order.push(seat);
    }
    order.sort((a, b) => {
      const pa = seatPosition(a), pb = seatPosition(b);
      const da = (pa[0] - scene.eye[0]) ** 2 + (pa[2] - scene.eye[2]) ** 2;
      const db = (pb[0] - scene.eye[0]) ** 2 + (pb[2] - scene.eye[2]) ** 2;
      return db - da;
    });
    for (const seat of order) {
      const person = table && table.players[seat];
      if (!person) continue;
      const at = seatPosition(seat);
      const mood = moods[seat];
      const mine = table.turn === seat && table.phase === 'playing';
      // Everything the seat knows, and under the names both paths read it by.
      //
      // This handful of fields is what a character is drawn from, and the copy
      // made here used to leave out the one that matters: `bones`. Without it
      // every one of these four went down the drawing path instead — a flat
      // cut-out turned to face the phone and floated at a written-down height,
      // while the skeleton it was supposed to be went on sitting correctly on
      // its chair, unseen, with the fan of cards still anchored to its hand.
      // That is the whole of what looked like people hovering over their
      // chairs and staring at the camera.
      drawFigure(person.char || SEAT_CHAR[seat],
        [at[0], FIGURE_BASE, at[2]], FIGURE_H,
        { wave: mood.wave, shake: mood.shakeVec, shakeVec: mood.shakeVec,
          bend: 0.075, grey: mood.grey, rim: mood.rimVec, rimVec: mood.rimVec,
          fall: mood.fall, bones: mood.bones, player: mood.player },
        mine ? [1.06, 1.03, 0.98, 1] : [1, 1, 1, 1]);
    }
    // The hand and the called card stay double sided: the call turns a full
    // circle in front of the table, and a culled back face is a card that
    // vanishes halfway round.
    drawHand();
    drawCall();
    gl.enable(gl.CULL_FACE);
    drawGlows(frame);

    positionPlates();
    requestAnimationFrame(render);
  }

  // ═══════════════════════════ the hand, under a finger ═══════════════════════════

  let grab = null;

  function stepHand(dt) {
    const count = table && table.hand ? table.hand.length : 0;
    if (handCards.length !== count) {
      handCards = [];
      for (let i = 0; i < count; i++) handCards.push({ lift: 0, drag: null });
    }
    const rate = clamp(dt * 9, 0, 1);
    handRaise += ((handUp ? 1 : 0) - handRaise) * clamp(dt * 7, 0, 1);
    if (!count) { handUp = false; handRaise = 0; }
    if (el.root) el.root.classList.toggle('is-handup', handUp);
    // Once the deal is over the hand is simply the hand, however the flights
    // went: a dropped frame must never cost the player a card.
    if (table && table.phase !== 'deal') handShown = count;
    for (let index = 0; index < count; index++) {
      const card = handCards[index];
      const want = selected.has(index) ? 1 : 0;
      card.lift += (want - card.lift) * rate;
      if (grab && grab.index === index) {
        card.drag = grab.offset;
      } else if (card.drag) {
        card.drag.y *= 1 - rate;
        card.drag.z *= 1 - rate;
        card.drag.yaw *= 1 - rate;
        if (Math.abs(card.drag.y) < 0.0005) card.drag = null;
      }
    }
  }

  const corner = [0, 0, 0, 0];
  function handQuad(index, count) {
    const card = handCards[index] || { lift: 0, drag: null };
    handMatrix(scratch, index, count, card.lift, card.drag);
    const points = [];
    for (const [lx, ly] of [[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
      const wx = scratch[0] * lx + scratch[4] * ly + scratch[12];
      const wy = scratch[1] * lx + scratch[5] * ly + scratch[13];
      const wz = scratch[2] * lx + scratch[6] * ly + scratch[14];
      m4.project(corner, scene.vp, wx, wy, wz);
      if (corner[3] <= 0) return null;
      points.push([(corner[0] * 0.5 + 0.5) * scene.width,
        (0.5 - corner[1] * 0.5) * scene.height]);
    }
    return points;
  }

  function inside(points, x, y) {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  function cardAt(x, y) {
    const count = table && table.hand ? table.hand.length : 0;
    for (let index = Math.min(count, handShown) - 1; index >= 0; index--) {
      const quad = handQuad(index, count);
      if (quad && inside(quad, x, y)) return index;
    }
    return -1;
  }

  function toggle(index) {
    if (!table || !table.canPlay) return;
    if (selected.has(index)) {
      selected.delete(index);
    } else {
      // As many as the table allows under one sentence, and no more. Past
      // that the newest card pushes the oldest one back down, so a tap is
      // never a tap that does nothing.
      const most = Math.max(1, table.maxThrow || 1);
      while (selected.size >= most) selected.delete(selected.values().next().value);
      selected.add(index);
      play('pick', 0.5);
    }
    paintControls();
  }

  function onDown(event) {
    if (!scene.ready) return;
    unlockSound();
    const box = scene.canvas.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    const index = table ? cardAt(x, y) : -1;
    event.preventDefault();
    grab = index < 0
      // Anywhere that is not a card is the room itself: drag it and you turn
      // to face whoever you want to look at.
      ? { id: event.pointerId, look: true, x, y, moved: false,
        yaw0: orbit.yaw, pitch0: orbit.pitch }
      : { id: event.pointerId, index, x, y, moved: false, raised: handUp,
        offset: { y: 0, z: 0, yaw: 0 } };
    try { scene.canvas.setPointerCapture(event.pointerId); } catch (_) { /* fine */ }
  }

  function onMove(event) {
    if (!grab || grab.id !== event.pointerId) return;
    event.preventDefault();
    const box = scene.canvas.getBoundingClientRect();
    const dy = (event.clientY - box.top) - grab.y;
    const dx = (event.clientX - box.left) - grab.x;
    grab.moved = grab.moved || Math.abs(dy) > 6 || Math.abs(dx) > 6;
    if (grab.look) {
      // The view follows the finger: drag right and the room comes right,
      // drag up and it comes up. The opposite is what a modelling program
      // does, and this is not a modelling program.
      const reach = 2.4 / Math.max(260, Math.min(scene.width, scene.height));
      orbit.yaw = clamp(grab.yaw0 + dx * reach, -YAW_LIMIT, YAW_LIMIT);
      orbit.pitch = clamp(grab.pitch0 - dy * reach * 0.55, -PITCH_LIMIT, PITCH_LIMIT);
      orbit.touched = frame;
      if (el.recenter) el.recenter.hidden = Math.abs(orbit.yaw) + Math.abs(orbit.pitch) < 0.04;
      return;
    }
    const pull = clamp(-dy / Math.max(120, scene.height * 0.28), 0, 1);
    grab.offset.y = pull * 0.16;
    grab.offset.z = -pull * 0.10;
    grab.offset.yaw = clamp(dx / 400, -0.3, 0.3);
    grab.pull = pull;
  }

  function onUp(event) {
    if (!grab || grab.id !== event.pointerId) return;
    event.preventDefault();
    const held = grab;
    grab = null;
    if (event.type === 'pointercancel') return;
    if (held.look) {
      // A tap on the room, not a drag: the hand goes back down.
      if (!held.moved && handUp) {
        handUp = false;
        selected.clear();
        play('tap', 0.3);
        paintControls();
      }
      return;
    }
    if (!held.moved) {
      if (!held.raised) {
        // The first touch on a resting hand only lifts it. Choosing a card
        // out of a tucked fan you cannot read is how a wrong card gets played.
        handUp = true;
        play('pick', 0.4);
        paintControls();
        return;
      }
      toggle(held.index);
      return;
    }
    if ((held.pull || 0) > 0.55 && table && table.canPlay) {
      if (!selected.has(held.index)) selected.add(held.index);
      throwSelected();
    }
  }

  // ═══════════════════════════ talking to the room ═══════════════════════════

  function roomError(error) {
    const code = String((error && error.message) || error || '');
    return text('errors.' + code) || text('errors.staleMove');
  }

  async function call(action, payload) {
    if (pending || !send) return;
    pending = true;
    paintControls();
    try {
      await send(action, payload || {});
    } catch (error) {
      shout(roomError(error));
    } finally {
      pending = false;
      paintControls();
    }
  }

  function throwSelected() {
    if (!table || !table.canPlay || !selected.size) return;
    const idx = Array.from(selected).sort((a, b) => a - b);
    selected.clear();
    handUp = false;
    play('throw', 0.85);
    call('card', { idx });
  }

  function accuse() {
    if (!table || !table.canChallenge) return;
    play('challenge', 0.9);
    bump(table.seat, 'challenge');
    call('challenge', {});
  }

  function shout(message) {
    if (!el.error) return;
    el.error.textContent = message;
    el.error.hidden = !message;
    errorAt = frame;
    window.setTimeout(() => {
      if (el.error && frame - errorAt > 2.4) el.error.hidden = true;
    }, 2600);
  }

  // ═══════════════════════════ the words on the glass ═══════════════════════════

  function icon(name, cls) {
    return '<svg class="' + (cls || 'lr-i') + '" aria-hidden="true"><use href="'
      + ICONS + '#lr-' + name + '"></use></svg>';
  }

  let ICONS = '';
  // The game perks badge, the owner's own drawing, worn on the locked face.
  let PERK_ICON = '';
  // Which chair the character picker is dressing: null is my own.
  let editSeat = null;

  function skeleton() {
    const rail = (side, buttons) => '<div class="lr-rail lr-rail-' + side + '">'
      + buttons.map((b) => '<button type="button" class="lr-rail-btn" data-do="' + b[0]
        + '">' + icon(b[1]) + '<span>' + esc(b[2]) + '</span></button>').join('') + '</div>';
    return ''
      + '<canvas class="lr-stage"></canvas>'
      + '<div class="lr-vignette" aria-hidden="true"></div>'
      + '<div class="lr-embers" aria-hidden="true">'
      + Array.from({ length: 22 }, (_, i) => '<i style="--i:' + i + ';--x:'
        + ((i * 37) % 100) + ';--d:' + (6 + (i * 13) % 7) + '"></i>').join('') + '</div>'
      + '<div class="lr-royale-banner" data-royalebanner hidden><b></b><small></small></div>'
      + '<div class="lr-ui">'
      // The call sits in the corner the round starts from and stays there for
      // the whole round, so nobody has to remember what was claimed.
      + '  <header class="lr-top">'
      + '    <div class="lr-call" data-call>'
      + '<img data-callart alt="" width="34" height="47">'
      + '<span><small></small><b></b></span></div>'
      + '    <div class="lr-meta"><span data-room></span><span data-round></span></div>'
      + '    <div class="lr-topend">'
      // Everything that used to be a button on the glass now lives behind
      // this one. Two rails of four buttons each is a cockpit, not a majlis,
      // and on a phone they sat over the table itself.
      + '      <button type="button" class="lr-chip lr-gear" data-do="menu" aria-label="'
      + esc(text('actions.menu')) + '">' + icon('gear') + '</button>'
      + '      <button type="button" class="lr-chip lr-exit" data-do="leave">' + icon('exit')
      + '<span>' + esc(text('actions.leave')) + '</span></button>'
      + '    </div>'
      + '  </header>'
      + '  <div class="lr-plates" data-plates></div>'
      + '  <div class="lr-pops" data-pops></div>'
      + '  <div class="lr-stagecard" data-stagecard hidden></div>'
      // Abu Saad's gifts: only ever drawn for the one who wears him with the
      // game perks. Everything in it came from the server for that seat alone.
      + '  <aside class="lr-gift" data-gift hidden>'
      + '    <header><img alt="" data-gifticon><b>' + esc(text('gift.title')) + '</b></header>'
      + '    <p class="lr-gift-sense" data-giftsense></p>'
      + '    <div class="lr-gift-row">'
      + '      <button type="button" class="lr-gift-btn" data-do="gift-peek">' + icon('peek')
      + '<span>' + esc(text('gift.peek')) + '</span></button>'
      + '      <button type="button" class="lr-gift-btn" data-do="gift-hawk">' + icon('hawk')
      + '<span>' + esc(text('gift.hawk')) + '</span></button>'
      + '    </div>'
      + '    <p class="lr-gift-saw" data-giftsaw hidden></p>'
      + '  </aside>'
      // The stickers stay exactly where the hand already looks for them.
      + rail('right', [['stickers', 'laugh', text('actions.stickers')]])
      // The mic keeps its corner too, and now it says which way it is: the
      // word under it changes, the frame lights, and a dot breathes while it
      // is open. A control whose state you cannot read is one you press twice
      // and trust neither time.
      + rail('left', [['mic', 'mic', text('mic.off')],
        ['recenter', 'rotate', text('actions.recenter')],
        ['view', 'view-first', text('actions.view_first')]])
      + '  <div class="lr-myturn" data-myturn hidden>'
      + '<i></i><b>' + esc(text('status.your_turn')) + '</b><em></em></div>'
      + '  <p class="lr-error" role="alert" hidden></p>'
      + '  <footer class="lr-actions">'
      + '    <p class="lr-hint" data-hint></p>'
      + '    <div class="lr-buttons">'
      + '      <button type="button" class="lr-btn lr-liar" data-do="challenge">'
      + icon('liar') + '<span>' + esc(text('actions.liar')) + '</span></button>'
      + '      <button type="button" class="lr-btn lr-play" data-do="play">'
      + icon('card') + '<span data-playlabel>' + esc(text('actions.throw')) + '</span></button>'
      + '    </div>'
      + '  </footer>'
      + '  <div class="lr-setup" data-setup hidden>'
      + '    <div class="lr-setup-card">'
      + '      <b>' + esc(text('setup.mode_title')) + '</b>'
      + '      <div class="lr-modepick" data-modepick></div>'
      + '      <b class="lr-setup-sub">' + esc(text('setup.who')) + '</b>'
      + '      <p data-whohint>' + esc(text('setup.who_body')) + '</p>'
      + '      <div class="lr-chairs" data-chairs></div>'
      + '      <div class="lr-whopick" data-whopick></div>'
      + '      <b class="lr-setup-sub" data-seatstitle>' + esc(text('setup.seats_title')) + '</b>'
      + '      <div class="lr-seatpick" data-seatpick></div>'
      + '      <small data-setupdeck></small>'
      + '      <button type="button" class="lr-btn lr-go" data-do="startmatch">'
      + '<span>' + esc(text('setup.start')) + '</span></button>'
      + '      <em data-setupwait hidden>' + esc(text('setup.waiting')) + '</em>'
      + '    </div>'
      + '  </div>'
      + '  <div class="lr-sheet" data-sheet hidden>'
      + '    <div class="lr-sheet-card"><header><b data-sheet-title></b>'
      + '<button type="button" data-do="closesheet" aria-label="' + esc(text('actions.close'))
      + '">' + icon('close') + '</button></header><div data-sheet-body></div></div>'
      + '  </div>'
      + '  <div class="lr-loading" data-loading><span></span><b>'
      + esc(text('hud.connecting')) + '</b></div>'
      + '</div>';
  }

  function plateMarkup(seat) {
    const key = SEAT_CHAR[seat % SEAT_CHAR.length];
    return '<div class="lr-plate" data-plate="' + seat + '" style="--accent:'
      + ACCENT[key] + '">'
      + '<span class="lr-badge">' + icon(EMBLEM[key], 'lr-badge-i') + '</span>'
      + '<span class="lr-plate-body"><b data-name></b><i data-state></i></span>'
      + '<span class="lr-cups" data-cups></span>'
      + '<svg class="lr-ring" viewBox="0 0 44 44" aria-hidden="true">'
      + '<circle class="lr-ring-bg" cx="22" cy="22" r="19"></circle>'
      + '<circle class="lr-ring-on" cx="22" cy="22" r="19"></circle></svg>'
      + '<b class="lr-cards" data-cards></b>'
      + '</div>';
  }

  /** One plate per chair, rebuilt only when the number of chairs changes. */
  function ensurePlates(count) {
    const key = count + ':' + selfSeat();
    if (!el.plateHolder || el.plateCount === key) return;
    el.plateCount = key;
    const seats = [];
    for (let seat = 0; seat < count; seat++) if (seat !== selfSeat()) seats.push(seat);
    el.plateHolder.innerHTML = seats.map(plateMarkup).join('');
    el.plates = [];
    for (const seat of seats) {
      el.plates[seat] = el.plateHolder.querySelector('[data-plate="' + seat + '"]');
    }
    if (el.popHolder) {
      /* Stickers and spoken lines both hang over the head of whoever sent
         them, in a layer of their own that never fades. The nameplate fades
         when you look away from a player, which is right for a name and quite
         wrong for something he just said: a line with no visible owner is a
         line from nobody. */
      let out = '';
      for (let seat = 0; seat < count; seat++) {
        out += '<div class="lr-pop" data-pop="' + seat + '" hidden></div>'
          + '<div class="lr-say" data-say="' + seat + '" hidden><b></b></div>';
      }
      el.popHolder.innerHTML = out;
      el.pops = [];
      el.says = [];
      for (let seat = 0; seat < count; seat++) {
        el.pops[seat] = el.popHolder.querySelector('[data-pop="' + seat + '"]');
        el.says[seat] = el.popHolder.querySelector('[data-say="' + seat + '"]');
      }
    }
  }

  function positionPlates() {
    if (!table) return;
    // The player's own sticker has no head on screen to sit over, so it sits
    // where his hands are, which is where he is looking anyway.
    if (el.pops && el.pops[mySeat()] && selfSeat() >= 0) {
      const mid = 'translate(-50%,-50%) translate3d('
        + (scene.width / 2).toFixed(0) + 'px,'
        + (scene.height * 0.52).toFixed(0) + 'px,0)';
      el.pops[mySeat()].style.transform = mid;
      if (el.says[mySeat()]) el.says[mySeat()].style.transform = mid;
    }
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === selfSeat()) continue;
      const pop = el.pops && el.pops[seat];
      const said = el.says && el.says[seat];
      if (pop || said) {
        const head = seatPosition(seat);
        const spot = toScreen(head[0], headroom(seat) + 0.05, head[2]);
        // Over the head it belongs to and nowhere else. It used to be pinned
        // inside the frame, which meant a line from somebody off to the side
        // slid along the bezel and read as coming from nobody; now it goes
        // where the head is, and when the head is not on the glass neither is
        // what it said.
        const seen = spot.w > 0.05
          && spot.x > -80 && spot.x < scene.width + 80
          && spot.y > -60 && spot.y < scene.height + 60;
        const x = spot.x;
        const y = Math.max(spot.y, 24);
        if (pop) {
          pop.style.opacity = seen ? '1' : '0';
          if (seen) {
            pop.style.transform = 'translate(-50%,-50%) translate3d('
              + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
          }
        }
        if (said) {
          said.style.opacity = seen ? '1' : '0';
          if (seen) {
            said.style.transform = 'translate(-50%,-100%) translate3d('
              + x.toFixed(1) + 'px,' + (y - 30).toFixed(1) + 'px,0)';
          }
        }
      }
    }
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === selfSeat()) continue;
      const node = el.plates[seat];
      if (!node) continue;
      const at = seatPosition(seat);
      const point = toScreen(at[0], headroom(seat), at[2]);
      if (point.w <= 0.05) { node.style.opacity = '0'; continue; }
      const depth = clamp(1.9 / point.w, 0.58, 1.05);
      // The plate stays over the head it belongs to and is never dragged back
      // into the frame. A name pinned to the bezel is a name sitting on the
      // buttons, which is what it was doing: so it simply fades out as its
      // owner leaves the middle of the view, and is read by looking at him.
      const away = Math.abs(point.x - scene.width / 2) / (scene.width / 2);
      const above = point.y / scene.height;
      const seen = away < 0.86 && above > 0.02 && above < 0.86;
      node.style.opacity = seen ? clamp(1.35 - away * 1.15, 0, 1).toFixed(2) : '0';
      node.style.transform = 'translate(-50%,-50%) translate3d('
        + point.x.toFixed(1) + 'px,' + point.y.toFixed(1) + 'px,0) scale('
        + depth.toFixed(3) + ')';
    }
  }

  function stepBubbles() {
    for (let seat = 0; seat < 10; seat++) {
      const bubble = bubbles[seat];
      const node = el.says && el.says[seat];
      if (!node) continue;
      if (!bubble || frame > bubble.until) {
        if (!node.hidden) node.hidden = true;
        bubbles[seat] = null;
        continue;
      }
      if (node.hidden) showBubble(node, bubble.text);
    }
  }

  /** A line, put over a head.
   *
   *  The words go in the inner mark and the animation runs on that. The
   *  bubble itself is never animated, because its transform is where it is
   *  over the head, written every frame; an animation on the same element
   *  overrides that transform and the words walk off across the glass. */
  function showBubble(node, line) {
    const inner = node.firstElementChild || node;
    inner.textContent = line;
    node.hidden = false;
    inner.classList.remove('is-said');
    void inner.offsetWidth;
    inner.classList.add('is-said');
  }

  function say(seat, kind) {
    const line = pickLine(seat, kind);
    if (!line) return;
    bubbles[seat] = { text: line.text, until: frame + 2.8 };
    // A line said is a line said with the hands. The mood carries it for as
    // long as the words are on the screen, and the skeleton reads it there.
    if (moods[seat]) moods[seat].talkUntil = frame + 2.6;
    const node = el.says && el.says[seat];
    if (node) showBubble(node, line.text);
    playVoice(seat, line.kind, line.index);
  }

  /** The tray he has left, and the lives behind it.
   *
   *  Two rows of the same idea: a dot for every cup still on his tray, and a
   *  heavier mark for every bitter cup he can still survive. A seat down to
   *  its last life is worth seeing across the table without reading a word. */
  function cupsMarkup(person) {
    let out = '';
    const lives = person.maxLives === undefined ? 0 : person.maxLives;
    for (let i = 0; i < lives; i++) {
      out += '<b class="' + (i < person.lives ? '' : 'gone') + '"></b>';
    }
    for (let i = 0; i < (person.total || 6); i++) {
      out += '<i class="' + (i < person.cups ? 'gone' : '') + '"></i>';
    }
    return out;
  }

  function paintPlates() {
    if (!table) return;
    ensurePlates(seatCount());
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === selfSeat()) continue;
      const node = el.plates[seat];
      const person = table.players[seat];
      if (!node || !person) continue;
      /* The plate wears the face its player actually chose. It used to wear
         whatever face the chair wore by default, which was right only while
         no two players could pick the same one. */
      const key = person.char || SEAT_CHAR[seat % SEAT_CHAR.length];
      if (node.dataset.char !== key) {
        node.dataset.char = key;
        node.style.setProperty('--accent', ACCENT[key] || '#e9c68a');
        const badge = node.querySelector('.lr-badge use');
        if (badge) badge.setAttribute('href', ICONS + '#lr-' + EMBLEM[key]);
      }
      node.querySelector('[data-name]').textContent = person.name || '';
      node.querySelector('[data-cards]').textContent = person.alive ? person.cards : '';
      node.querySelector('[data-cups]').innerHTML = cupsMarkup(person);
      const state = node.querySelector('[data-state]');
      state.textContent = !person.alive ? text('status.out')
        : (table.turn === seat && table.phase === 'playing' ? text('status.thinking')
          : (person.safe ? text('status.safe') : text('status.ready')));
      node.classList.toggle('is-out', !person.alive);
      node.classList.toggle('is-turn', table.turn === seat && table.phase === 'playing');
      node.classList.toggle('is-talking', talking.has(person.id));
    }
  }

  function paintClock() {
    if (!table || !el.plates) return;
    const total = table.turnSeconds || 25;
    const left = table.turnDeadline
      ? clamp((table.turnDeadline - (Date.now() + skew)) / 1000, 0, total) : 0;
    const part = table.phase === 'playing' ? left / total : 0;
    for (let seat = 0; seat < seatCount(); seat++) {
      if (seat === selfSeat()) continue;
      const node = el.plates[seat];
      if (!node) continue;
      const ring = node.querySelector('.lr-ring-on');
      const on = table.turn === seat && table.phase === 'playing';
      ring.style.strokeDashoffset = String(119.4 * (1 - (on ? part : 0)));
    }
    /* Whose turn it is, said plainly.

       The ring on the table says it for everybody, but the player holding the
       phone is looking at his own cards, not at the wood, so his turn is said
       again where his eyes already are: a badge over the bar, counting down,
       and the whole frame taking a warm edge while the clock is his. */
    const mine = table.seat !== null && table.seat === table.turn
      && table.phase === 'playing';
    if (el.myturn) {
      el.myturn.hidden = !mine;
      if (mine) {
        el.myturn.querySelector('em').textContent = String(Math.ceil(left));
        el.myturn.classList.toggle('is-urgent', left <= 6);
      }
    }
    el.root.classList.toggle('is-turnmine', mine);
    if (mine) {
      el.root.style.setProperty('--urgent', left <= 6 ? '1' : '0');
      if (left <= 5.2 && left > 0 && frame - (paintClock.tick || 0) > 0.9) {
        paintClock.tick = frame;
        play('tick', 0.35);
      }
    }
  }

  /** The one screen shown before a card is dealt: how many chairs.
   *
   *  It lives inside the table rather than in the room's lobby, because the
   *  size of the deck follows from it and the deck belongs to the game.
   */
  function paintSetup() {
    if (!el.setup || !table) return;
    const on = table.phase === 'setup';
    el.setup.hidden = !on;
    el.root.classList.toggle('is-setup', on);
    if (!on) return;
    const here = table.players.filter((p) => !p.bot).length;
    const low = Math.max(table.minSeats || 2, here);
    const key = table.seats + ':' + low + ':' + (table.host ? 1 : 0);
    if (el.seatpick.dataset.key !== key) {
      el.seatpick.dataset.key = key;
      let out = '';
      for (let count = table.minSeats || 2; count <= (table.maxSeats || 5); count++) {
        out += '<button type="button" class="lr-seat'
          + (count === table.seats ? ' on' : '') + '"'
          + (count < low || !table.host ? ' disabled' : '')
          + ' data-seats="' + count + '">' + count + '</button>';
      }
      el.seatpick.innerHTML = out;
    }
    // Every player answers for his own chair; the host also dresses the
    // chairs the bots sit in, which is how he picks who he plays against.
    // The locked face shows its lock to anyone without the game perks.
    const seated = table.seat !== null && table.seat !== undefined;
    const royale = table.mode === 'royale';
    const bots = table.host ? table.players.filter((p) => p.bot).map((p) => p.seat) : [];
    if (editSeat !== null && !bots.includes(editSeat)) editSeat = null;
    const target = editSeat === null ? table.seat : editSeat;
    const current = target === null || target === undefined ? ''
      : ((table.players[target] || {}).char || '');
    const mine = editSeat === null ? (table.pick || '') : current;
    const locked = table.locked || [];
    const modeKey = (table.mode || 'classic') + ':' + (table.host ? 1 : 0);
    if (el.modepick && el.modepick.dataset.key !== modeKey) {
      el.modepick.dataset.key = modeKey;
      el.modepick.innerHTML = ['classic', 'royale'].map((mode) => ''
        + '<button type="button" class="lr-mode lr-mode-' + mode
        + ((table.mode || 'classic') === mode ? ' on' : '') + '"'
        + (table.host ? '' : ' disabled') + ' data-mode="' + mode + '">'
        + icon(mode === 'royale' ? 'royale' : 'card')
        + '<b>' + esc(text('setup.' + mode)) + '</b>'
        + '<small>' + esc(text('setup.' + mode + '_body')) + '</small></button>').join('');
    }
    el.root.classList.toggle('is-royale', royale);
    const chairKey = bots.join(',') + ':' + editSeat + ':'
      + table.players.map((p) => p.char).join(',');
    if (el.chairs && el.chairs.dataset.key !== chairKey) {
      el.chairs.dataset.key = chairKey;
      el.chairs.hidden = !bots.length;
      let n = 0;
      el.chairs.innerHTML = (seated ? '<button type="button" class="lr-chair'
        + (editSeat === null ? ' on' : '') + '" data-chair="me">'
        + '<span>' + esc(text('setup.me')) + '</span></button>' : '')
        + bots.map((seat) => {
          n += 1;
          const key = table.players[seat].char;
          return '<button type="button" class="lr-chair' + (editSeat === seat ? ' on' : '')
            + '" data-chair="' + seat + '" style="--accent:' + (ACCENT[key] || '#e9c68a') + '">'
            + '<img alt="" src="' + stamp(ASSETS + '/art/char-' + key + '.webp') + '">'
            + '<span>' + esc(text('setup.rival', { n })) + '</span></button>';
        }).join('');
    }
    if (el.whohint) {
      el.whohint.textContent = text(editSeat === null ? 'setup.who_body' : 'setup.rivals_body');
    }
    const who = (table.characters || SEAT_CHAR).join(',') + ':' + mine + ':' + current
      + ':' + (seated ? 1 : 0) + ':' + editSeat + ':' + (table.perks ? 1 : 0);
    if (el.whopick && el.whopick.dataset.key !== who) {
      el.whopick.dataset.key = who;
      el.whopick.innerHTML = (table.characters || SEAT_CHAR).map((key) => {
        const shut = locked.includes(key) && !table.perks;
        return '<button type="button" class="lr-who' + (key === mine ? ' on' : '')
          + (shut ? ' is-locked' : '') + (locked.includes(key) ? ' is-gifted' : '')
          + '" style="--accent:' + (ACCENT[key] || '#e9c68a') + '"'
          + (seated ? '' : ' disabled') + ' data-char="' + key + '"'
          + (shut ? ' title="' + esc(text('setup.locked')) + '"' : '') + '>'
          + '<img alt="" loading="lazy" src="'
          + stamp(ASSETS + '/art/char-' + key + '.webp') + '">'
          + (shut ? '<i class="lr-lock">' + icon('lock') + '</i>' : '')
          + (locked.includes(key) ? '<i class="lr-perk"><img alt="" src="' + PERK_ICON + '"></i>' : '')
          + '<span>' + esc(charName(key)) + '</span></button>';
      }).join('');
    }
    if (el.seatpick) el.seatpick.hidden = royale;
    if (el.seatsTitle) {
      el.seatsTitle.textContent = text(royale ? 'setup.royale_seats' : 'setup.seats_title');
    }
    el.setupDeck.textContent = text('setup.deck',
      { n: table.faceCount || 6, w: table.wildCount || 2 });
    el.setupStart.hidden = !table.host;
    el.setupWait.hidden = !!table.host;
  }

  /** The mic button, said three ways at once: the mark, the word under it,
   *  and the frame. One of the three will be the one he reads. */
  function paintMic() {
    const button = el.mic;
    if (!button) return;
    const open = micLive();
    if (button.dataset.on === (open ? '1' : '0')) return;
    button.dataset.on = open ? '1' : '0';
    button.classList.toggle('is-live', open);
    button.setAttribute('aria-pressed', open ? 'true' : 'false');
    const word = button.querySelector('span');
    if (word) word.textContent = text(open ? 'mic.on' : 'mic.off');
    const mark = button.querySelector('use');
    if (mark) mark.setAttribute('href', ICONS + (open ? '#lr-mic' : '#lr-micoff'));
  }

  /** Abu Saad's panel. The sense for a lie is always on; the two gifts are
   *  once a round each, and what they showed stays until the round turns. */
  let giftSeen = '';
  function paintGift() {
    if (!el.gift) return;
    const gift = table && table.gift;
    const live = !!gift && (table.phase === 'playing' || table.phase === 'deal'
      || table.phase === 'reveal');
    el.gift.hidden = !live;
    el.root.classList.toggle('is-gifted', !!gift);
    if (!live) return;
    const sense = gift.insight;
    if (sense) {
      const name = (table.players[sense.seat] || {}).name || '';
      el.giftSense.textContent = text(sense.lie ? 'gift.insight_lie' : 'gift.insight_truth', { name });
      el.giftSense.dataset.tone = sense.lie ? 'lie' : 'truth';
      el.giftSense.style.setProperty('--sure', String(sense.sure || 0.6));
    } else {
      el.giftSense.textContent = text('gift.insight_wait');
      el.giftSense.dataset.tone = '';
    }
    const playing = table.phase === 'playing';
    el.giftPeek.disabled = !gift.peek || !playing || pending;
    el.giftHawk.disabled = !gift.hawk || !playing || pending;
    el.giftPeek.classList.toggle('is-spent', !gift.peek);
    el.giftHawk.classList.toggle('is-spent', !gift.hawk);
    let saw = '';
    if (gift.peeked) {
      saw += text('gift.peek_saw', {
        name: (table.players[gift.peeked.seat] || {}).name || '',
        face: faceName(gift.peeked.card),
      });
    }
    if (gift.hawked) {
      saw += (saw ? ' · ' : '') + text('gift.hawk_saw',
        { n: gift.hawked.count, face: faceName(gift.hawked.face) });
    }
    el.giftSaw.hidden = !saw;
    el.giftSaw.textContent = saw;
    // A fresh sight gets its own moment: the card rises for him alone.
    const mark = (gift.peeked ? gift.peeked.at : 0) + ':' + (gift.hawked ? gift.hawked.at : 0);
    if (mark !== giftSeen) {
      const first = giftSeen === '';
      giftSeen = mark;
      if (!first && gift.peeked && Date.now() - gift.peeked.at < 4000) showPeek(gift.peeked);
      if (!first && gift.hawked && Date.now() - gift.hawked.at < 4000) play('gift', 0.7);
    }
  }

  /** The stolen look: the card, face up, held a breath in the middle of the
   *  screen with the owner's name under it, then gone. */
  function showPeek(seen) {
    if (!el.stagecard) return;
    play('gift', 0.8);
    const who = (table.players[seen.seat] || {}).name || '';
    el.stagecard.innerHTML = '<div class="lr-peekcard"><img alt="" src="'
      + stamp(ASSETS + '/art/card-' + seen.card + '.webp') + '"><b>'
      + esc(text('gift.peek_saw', { name: who, face: faceName(seen.card) })) + '</b></div>';
    el.stagecard.hidden = false;
    el.stagecard.classList.add('is-peek');
    window.setTimeout(() => {
      if (!el.stagecard) return;
      el.stagecard.classList.remove('is-peek');
      el.stagecard.hidden = true;
      el.stagecard.innerHTML = '';
    }, 2600);
  }

  function peekSheet() {
    if (!table || !table.gift) return;
    const rivals = table.players.filter((p) => p.seat !== table.seat && p.alive && p.cards > 0);
    openSheet(text('gift.peek'), '<p class="lr-tip">' + esc(text('gift.peek_pick')) + '</p>'
      + '<div class="lr-peekpick">' + rivals.map((p) => ''
        + '<button type="button" data-peek="' + p.seat + '" style="--accent:'
        + (ACCENT[p.char] || '#e9c68a') + '"><img alt="" src="'
        + stamp(ASSETS + '/art/char-' + p.char + '.webp') + '"><span>' + esc(p.name)
        + '</span><small>' + p.cards + '</small></button>').join('') + '</div>');
  }

  /** The view button says which of the three it is showing now. */
  function paintView() {
    const button = el.viewBtn;
    if (!button) return;
    const mode = viewMode();
    if (button.dataset.shown === mode) return;
    button.dataset.shown = mode;
    const mark = button.querySelector('use');
    if (mark) mark.setAttribute('href', ICONS + '#lr-view-' + mode);
    const word = button.querySelector('span');
    if (word) word.textContent = text('actions.view_' + mode);
    el.root.dataset.view = mode;
  }

  function paintControls() {
    if (!table || !el.play) return;
    paintMic();
    paintView();
    paintGift();
    paintRoyale();
    el.root.classList.toggle('is-royale', table.mode === 'royale');
    const mine = table.seat === table.turn && table.phase === 'playing';
    const count = selected.size;
    const over = table.phase === 'done';
    // When the majlis ends the same two buttons carry the two things left to
    // do, rather than a third row appearing where nothing was before.
    el.liar.dataset.do = over ? 'rematch' : 'challenge';
    el.play.dataset.do = over ? 'reallyleave' : 'play';
    el.liar.querySelector('span').textContent = over
      ? text('done.again') : text('actions.liar');
    el.liar.disabled = over ? pending : (!table.canChallenge || pending);
    el.play.disabled = over ? pending : (!table.canPlay || pending || count === 0);
    el.playLabel.textContent = over ? text('done.exit')
      : (count > 1 ? text('actions.throw_two')
        : (count ? text('actions.throw_n') : text('actions.throw')));
    el.play.classList.toggle('is-armed', over || count > 0);
    // Every hand is empty and the claim has to be answered: the word is the
    // only button on the table that still does anything.
    el.liar.classList.toggle('is-forced', !!(table.forced && mine));
    el.root.classList.toggle('is-over', over);
    el.root.classList.toggle('is-mine', mine);
    const face = faceName(table.call);
    let hint = '';
    if (table.phase === 'deal') hint = text('round.new', { face });
    else if (table.phase === 'reveal') hint = text('reveal.claimed',
      { n: table.reveal ? table.reveal.count : 0, face });
    else if (table.phase === 'cup') hint = text('cup.pouring',
      { name: (table.players[table.cup ? table.cup.seat : 0] || {}).name || '' });
    else if (table.phase === 'done') hint = text('done.winner',
      { name: (table.players[table.winner] || {}).name || '' });
    else if (mine && table.forced) hint = text('prompt.must');
    else if (mine) hint = count ? text(count > 1 ? 'prompt.claim_two' : 'prompt.claim', { face })
      : (handRaise > 0.5 ? text('prompt.pick_cards')
        : (table.canChallenge ? text('prompt.your_turn') : text('prompt.your_turn_first')));
    else hint = text('status.waiting', { name: (table.players[table.turn] || {}).name || '' });
    el.hint.textContent = hint;
    if (el.call) {
      el.call.querySelector('b').textContent = face;
      el.call.querySelector('small').textContent = text('hud.call');
      el.call.dataset.face = table.call;
      const art = el.call.querySelector('[data-callart]');
      const want = stamp(ASSETS + '/art/card-' + table.call + '.webp');
      if (art && art.getAttribute('src') !== want) art.setAttribute('src', want);
    }
  }

  function paintMeta() {
    if (!table) return;
    if (el.room) {
      el.room.textContent = room && room.code ? text('hud.room', { code: room.code }) : '';
    }
    if (el.round) el.round.textContent = text('hud.round', { n: table.round });
  }

  // ═══════════════════════════ sheets ═══════════════════════════

  function openSheet(title, body) {
    el.sheetTitle.textContent = title;
    el.sheetBody.innerHTML = body;
    el.sheet.hidden = false;
    const card = el.sheet.querySelector('.lr-sheet-card');
    if (card) card.scrollTop = 0;
    play('tap', 0.4);
  }

  /** Give one panel its scrolling back. */
  function letScroll(host, inside) {
    if (!host) return;
    const card = () => host.querySelector(inside);
    const room = (node) => node.scrollHeight - node.clientHeight;
    host.addEventListener('wheel', (event) => {
      const node = card();
      if (!node || room(node) <= 1) return;
      node.scrollTop = clamp(node.scrollTop + event.deltaY, 0, room(node));
      event.preventDefault();
    }, { passive: false });
    let dragAt = null;
    host.addEventListener('touchstart', (event) => {
      dragAt = event.touches.length === 1 ? event.touches[0].clientY : null;
    }, { passive: true });
    host.addEventListener('touchmove', (event) => {
      const node = card();
      if (!node || dragAt === null || event.touches.length !== 1) return;
      if (room(node) <= 1) return;
      const now = event.touches[0].clientY;
      node.scrollTop = clamp(node.scrollTop + (dragAt - now), 0, room(node));
      dragAt = now;
      event.preventDefault();
    }, { passive: false });
  }

  function closeSheet() {
    if (!el.sheet || el.sheet.hidden) return false;
    el.sheet.hidden = true;
    return true;
  }

  /** The rules, laid out the way they are learned rather than the way they
   *  are enforced: what you are trying to do, what happens before a deal,
   *  what a round is step by step, and what the cup costs.
   *
   *  One flat list of nine sentences was what this used to be, and a flat
   *  list is where a rule goes to be skipped. */
  function rulesSheet() {
    const said = (key) => (words.rules && words.rules[key]) || [];
    // A word between two asterisks is the word the sentence turns on. Written
    // that way in the content file so a translator marks emphasis without
    // being handed a tag to get wrong, and escaped before it is read.
    const strong = (line) => esc(line).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const block = (title, key, ordered) => '<h4 class="lr-rules-h">'
      + esc(text('rules.' + title)) + '</h4>'
      + '<' + (ordered ? 'ol' : 'ul') + ' class="lr-rules">'
      + said(key).map((line) => '<li>' + strong(line) + '</li>').join('')
      + '</' + (ordered ? 'ol' : 'ul') + '>';
    // The four faces first. A rule about the joker is a sentence; the joker
    // beside the other three is the same rule, understood at a glance.
    const deck = FACES.concat(['W']).map((face) => '<figure><img alt="" src="'
      + stamp(ASSETS + '/art/card-' + face + '.webp') + '">'
      + '<figcaption>' + esc(faceName(face)) + '</figcaption></figure>').join('');
    const counts = table
      ? '<p class="lr-tip">' + esc(text('rules.deck',
        { seats: table.seats, n: table.faceCount, w: table.wildCount })) + '</p>'
      : '';
    openSheet(text('rules.title'),
      '<p class="lr-rules-goal">' + esc(text('rules.goal')) + '</p>'
      + '<div class="lr-deckrow">' + deck + '</div>' + counts
      + block('before_title', 'before', false)
      + block('round_title', 'round', true)
      + block('cup_title', 'cup', false)
      + block('hints_title', 'hints', false)
      + '<p class="lr-tip">' + esc(text('rules.tip')) + '</p>');
  }

  function logSheet() {
    const rows = (table && table.log) || [];
    openSheet(text('actions.log'), '<ul class="lr-log">' + rows.slice().reverse()
      .map((entry) => '<li>' + esc(text('log.' + entry.k, entry.a || {})) + '</li>')
      .join('') + '</ul>');
  }

  /** Is my own microphone open? The room knows; the table only reads it. */
  function micLive() {
    if (!room || !room.players) return false;
    const me = room.players.find((person) => person.id === room.you);
    return !!(me && me.mic);
  }

  /** The gear: one door for everything that is not a live control. */
  function menuSheet() { moreSheet(); }

  function moreSheet() {
    const q = QUALITIES.map((key) => '<button type="button" class="lr-pick'
      + (quality === key ? ' on' : '') + '" data-quality="' + key + '">'
      + esc(text('quality.' + key)) + '</button>').join('');
    const open = micLive();
    openSheet(text('actions.menu'),
      '<div class="lr-more">'
      + '<button type="button" class="lr-wide lr-mic-row' + (open ? ' on' : '')
      + '" data-do="mic">' + icon(open ? 'mic' : 'micoff')
      + esc(text(open ? 'mic.on' : 'mic.off'))
      + '<i class="lr-mic-state">' + esc(text(open ? 'mic.live' : 'mic.shut'))
      + '</i></button>'
      + '<button type="button" class="lr-wide" data-do="rules">' + icon('rules')
      + esc(text('actions.rules')) + '</button>'
      + '<button type="button" class="lr-wide" data-do="log">' + icon('log')
      + esc(text('actions.log')) + '</button>'
      + '<button type="button" class="lr-wide" data-do="chat">' + icon('chat')
      + esc(text('actions.chat')) + '</button>'
      + '<button type="button" class="lr-wide" data-do="recenter">' + icon('rotate')
      + esc(text('actions.recenter')) + '</button>'
      + '<button type="button" class="lr-wide" data-do="sound">' + icon('sound')
      + esc(text(mute ? 'actions.sound_off' : 'actions.sound_on')) + '</button>'
      + '<button type="button" class="lr-wide" data-do="invite">' + icon('more')
      + esc(text('actions.invite')) + '</button>'
      + '<div class="lr-quality"><small>' + esc(text('actions.quality')) + '</small>'
      + '<div class="lr-picks">' + q + '</div>'
      + '<small class="lr-tip">' + esc(text('quality.note')) + '</small></div>'
      + '<button type="button" class="lr-wide lr-danger" data-do="confirmleave">'
      + icon('exit') + esc(text('actions.leave')) + '</button>'
      + '</div>');
  }

  function chatSheet() {
    openSheet(text('actions.chat'),
      '<div class="lr-chat"><input data-chatline type="text" maxlength="140"'
      + ' autocomplete="off" aria-label="' + esc(text('actions.chat')) + '">'
      + '<button type="button" class="lr-wide" data-do="sendchat">'
      + esc(text('actions.chat')) + '</button></div>');
    const field = el.sheet.querySelector('[data-chatline]');
    if (field) field.focus();
  }

  function leaveSheet() {
    if (!table || table.phase === 'done') { call('leave'); return; }
    openSheet(text('exit.title'),
      '<p class="lr-ask">' + esc(text('exit.body')) + '</p>'
      + '<div class="lr-ask-row">'
      + '<button type="button" class="lr-wide lr-danger" data-do="reallyleave">'
      + esc(text('exit.yes')) + '</button>'
      + '<button type="button" class="lr-wide" data-do="closesheet">'
      + esc(text('exit.no')) + '</button></div>');
  }

  // ═══════════════════════════ the stage card ═══════════════════════════
  /* One line across the middle of the screen for the three moments that
     decide a round. It is the only thing allowed to cover the table. */

  function stage(kind, title, note) {
    if (!el.stagecard) return;
    el.stagecard.hidden = false;
    el.stagecard.dataset.kind = kind;
    el.stagecard.innerHTML = '<b>' + esc(title) + '</b>'
      + (note ? '<span>' + esc(note) + '</span>' : '');
  }

  function clearStage() {
    if (el.stagecard) el.stagecard.hidden = true;
  }

  // ═══════════════════════════ reading the new state ═══════════════════════════

  function handOrigin(seat) {
    if (seat === mySeat()) {
      const cw = scene.camWorld;
      const local = [0, -0.16, -0.52];
      return [
        cw[0] * local[0] + cw[4] * local[1] + cw[8] * local[2] + cw[12],
        cw[1] * local[0] + cw[5] * local[1] + cw[9] * local[2] + cw[13],
        cw[2] * local[0] + cw[6] * local[1] + cw[10] * local[2] + cw[14],
      ];
    }
    // Out of the hand that is holding them, when that hand is known. A card
    // that leaves a point in the air beside a person is a card nobody threw.
    const held = inHand(seat, flightFrom);
    if (held) return held.slice();
    const at = seatPosition(seat);
    return [at[0] * 0.80, TABLE_Y + 0.22, at[2] * 0.80];
  }

  const flightFrom = [0, 0, 0];

  function fly(seat, count, kind) {
    const from = handOrigin(seat);
    for (let i = 0; i < count; i++) {
      const order = pile.length + flights.length + i;
      const spot = kind === 'pile' ? restingSpot(order) : null;
      const target = spot ? [spot.x, spot.y, spot.z] : handOrigin(seat);
      flights.push({
        at: frame + i * 0.09, dur: 0.46, kind: kind || 'pile',
        from: from.slice(), to: target,
        spin0: Math.atan2(-from[0], -from[2]),
        spin1: spot ? spot.spin : 0,
        roll: seat === mySeat() ? 1 : 0.6,
        face: 'back',
      });
    }
  }

  /** The deal.
   *
   *  Round the table and round again, one card to each player before anybody
   *  gets a second — which is how a hand is dealt and, more to the point, is
   *  what makes the wait readable: you can count your own cards arriving.
   *  Each one leaves the stack in the middle, arcs over the wood and lands in
   *  its own place in the fan, and only then is it yours to look at.
   */
  function dealVisual() {
    pile = [];
    flights = [];
    selected.clear();
    handUp = false;
    handShown = 0;
    if (reduced) { handShown = 99; return; }
    const seats = [];
    for (let seat = 0; seat < seatCount(); seat++) {
      const person = table.players[seat];
      if (person && person.alive) seats.push(seat);
    }
    const start = frame + 5.1;
    const step = 0.085;
    let order = 0;
    for (let round = 0; round < 5; round++) {
      for (const seat of seats) {
        const to = handOrigin(seat);
        flights.push({
          at: start + order * step,
          dur: 0.46,
          kind: 'deal',
          seat,
          slot: round,
          from: [0, TABLE_Y + 0.03 + round * 0.004, 0],
          to,
          spin0: 0,
          spin1: Math.atan2(-to[0], -to[2]),
          roll: seat === mySeat() ? 0.85 : 0.45,
          arc: seat === mySeat() ? 0.20 : 0.30,
          face: 'back',
        });
        order += 1;
      }
    }
  }

  function onDeal() {
    // The round opens by telling everyone the same thing: the called card is
    // stood up in the middle of the table and turned a full circle so that
    // all four read it off the same face, and only then does it fold away
    // into the corner of the screen where it stays for the round.
    callShow = { at: frame, face: table.call };
    // The one nudge of the round, and the hand comes up to meet its cards.
    orbit.snapAt = frame;
    orbit.snapUntil = frame + 0.95;
    dealVisual();
    // Rejoining a round that started without us: the cards already on the
    // table are laid straight down. Animating them would be a lie about when
    // they were played, and an empty table would be a lie about the count.
    const already = table.thrown || 0;
    for (let index = 0; index < already; index++) {
      const spot = restingSpot(index);
      pile.push({ x: spot.x, y: spot.y, z: spot.z, spin: spot.spin,
        face: 'back', reveal: null });
    }
    if (already) flights = [];
    const face = faceName(table.call);
    const opens = (table.players[table.turn] || {}).name || '';
    // No shuffle over the top of the deal: twenty cards landing one after
    // another is already the sound of a deal, and a burst of noise on top of
    // it was the loudest thing in the game.
    window.setTimeout(() => {
      if (!table) return;
      stage('call', text('round.new', { face }), text('round.starts', { name: opens }));
    }, 4900);
    window.setTimeout(clearStage, 7200);
  }

  function onThrow(seat, count) {
    fly(seat, count, 'pile');
    bump(seat, 'throw');
    if (seat !== table.seat) say(seat, Math.random() < 0.4 ? 'bluff' : 'throw');
    if (seat !== table.seat) play('throw', 0.55);
  }

  function onReveal() {
    const reveal = table.reveal;
    if (!reveal) return;
    play('reveal', 0.8);
    bump(reveal.caller, 'challenge');
    say(reveal.caller, 'challenge');
    const face = faceName(reveal.face);
    window.setTimeout(() => {
      if (!table || !table.reveal) return;
      play(reveal.lied ? 'lie' : 'truth', 0.85);
      stage(reveal.lied ? 'lie' : 'truth',
        reveal.lied ? text('reveal.liar', { face }) : text('reveal.truth', { face }),
        text('reveal.loser', { name: (table.players[reveal.loser] || {}).name || '' }));
      bump(reveal.loser, 'caught');
      say(reveal.loser, 'caught');
    }, 900);
  }

  function onCup() {
    const cup = table.cup;
    if (!cup) return;
    const sip = Math.max(1.6, (cup.revealAt - (Date.now() + skew)) / 1000);
    ceremony = {
      at: frame, index: cup.index, total: cup.total, bitter: !!cup.bitter,
      // Poison ends a seat the first time. What the lives count is the other
      // side of it: how many plain cups he is still allowed to be spared by
      // before the next one is poison whatever the tray holds.
      fatal: !!cup.fatal, lives: cup.lives || 0, doomed: !!cup.doomed,
      seat: cup.seat, sip, told: false,
    };
    play('pour', 0.75);
    stage('cup', text('cup.title'), text('cup.left', { n: cup.left }));
  }

  function tellCup() {
    if (!ceremony || !table) return;
    const waited = frame - ceremony.at;
    // A tick under the silence, closing up as the cup comes to the mouth.
    // Nothing else moves at that point, and a room with nothing in it at all
    // reads as a hang rather than as a held breath.
    if (!ceremony.told && waited > CUP_SET && waited < ceremony.sip) {
      const near = clamp((waited - CUP_SET) / Math.max(0.1, ceremony.sip - CUP_SET), 0, 1);
      const gap = mix(0.62, 0.20, near);
      if (waited - (ceremony.beat || 0) >= gap) {
        ceremony.beat = waited;
        play('tick', 0.22 + near * 0.28);
      }
    }
    if (ceremony.told) return;
    if (waited < ceremony.sip) return;
    ceremony.told = true;
    const name = (table.players[ceremony.seat] || {}).name || '';
    const mine = ceremony.seat === table.seat;
    if (ceremony.bitter) {
      // Poison, and poison is the end of a seat — the first cup of it and
      // every cup of it. There is no second reading of this one.
      play('bitter', 0.9);
      stage('bitter', mine ? text('cup.mine_bitter') : text('cup.bitter', { name }));
      bump(ceremony.seat, 'out');
      say(ceremony.seat, 'out');
    } else {
      // Spared, and that is what costs him: the cup was plain, and one of the
      // two he was allowed goes with it. When the last one goes we say so
      // plainly, because the next cup he is poured is poison for certain.
      const left = Math.max(0, ceremony.lives - 1);
      play('safe', 0.8);
      stage('safe', mine ? text('cup.mine_safe') : text('cup.safe', { name }),
        left ? text(mine ? 'cup.mine_lives' : 'cup.lives', { n: left })
          : text('cup.last'));
      bump(ceremony.seat, 'safe');
      say(ceremony.seat, 'safe');
    }
  }

  function onRoundEnd() {
    ceremony = null;
    window.setTimeout(clearStage, 1400);
  }

  function onDone() {
    ceremony = null;
    const won = table.winner === table.seat;
    play(won ? 'win' : 'lose', 0.9);
    stage(won ? 'win' : 'lose',
      won ? text('done.you_win') : text('done.winner',
        { name: (table.players[table.winner] || {}).name || '' }),
      won ? '' : text('done.you_lose'));
    if (table.winner != null) say(table.winner, 'won');
  }

  function paint(view, roomInfo) {
    if (!view || view.game !== 'liar') return;
    room = roomInfo || room;
    if (!ready) { queued = { view, roomInfo }; return; }
    const before = table;
    const beforeThrown = before ? before.thrown : 0;
    const beforePhase = before ? before.phase : '';
    const beforeRound = before ? before.round : -1;
    table = view;
    skew = (view.serverNow || Date.now()) - Date.now();
    // Every face at the table is fetched the moment it sits down, not the
    // first frame it happens to be drawn in.
    if (scene.modelIndex) for (const person of view.players || []) if (person.char) wantModel(person.char);

    // Round zero is the table asking how many are playing; there is nothing
    // to deal and nothing to call until somebody has answered.
    if (view.round !== beforeRound && view.round > 0) {
      shownRound = view.round;
      onDeal();
    } else if (view.thrown > beforeThrown && view.last) {
      onThrow(view.last.seat, view.thrown - beforeThrown);
    }
    if (view.phase !== beforePhase) {
      if (view.phase === 'reveal') onReveal();
      if (view.phase === 'cup') onCup();
      if (view.phase === 'round_done') onRoundEnd();
      if (view.phase === 'done') onDone();
      if (view.phase === 'playing' && view.turn === view.seat) play('turn', 0.5);
    }
    if (before) {
      for (let seat = 0; seat < Math.min(before.players.length, view.players.length); seat++) {
        if (before.players[seat] && before.players[seat].alive && !view.players[seat].alive) {
          bump(seat, 'out');
        }
      }
    }
    /* The hand lifts itself twice: while it is being dealt, so the cards
       arrive big enough to read and then settle, and again the moment the
       turn comes round, so a player who has looked away does not have to be
       told in words that it is his move. It drops when the turn passes, and
       a tap on the table still overrules all of it. */
    const wasMine = !!(before && before.seat !== null
      && before.turn === before.seat && before.phase === 'playing');
    const nowMine = !!(view.seat !== null && view.turn === view.seat
      && view.phase === 'playing');
    if (view.phase === 'deal') handUp = true;
    else if (nowMine && !wasMine) handUp = true;
    else if (!nowMine && (wasMine || (before && before.phase === 'deal'))) handUp = false;

    if (view.seat !== (before ? before.seat : null)) selected.clear();
    const most = view.hand ? view.hand.length : 0;
    for (const index of Array.from(selected)) if (index >= most) selected.delete(index);
    shownRev = view.rev;
    shownPhase = view.phase;
    paintPlates();
    paintSetup();
    paintControls();
    paintMeta();
    readStickers();
  }

  // ═══════════════════════════ mounting ═══════════════════════════

  let ready = false;
  let queued = null;
  let observer = null;
  let wentFull = false;

  /** The one folder of stickers the whole of Shahd shares. */
  async function loadStickers() {
    if (stickerPack) return stickerPack;
    try {
      // The one file here that carries no version of its own, so it is asked
      // for rather than assumed: a sticker added to the pack has to show up
      // without waiting for a browser to forget the old list.
      const index = await fetch(STICKERS + 'index.json', { cache: 'no-cache' })
        .then((response) => (response.ok ? response.json() : null));
      const packs = (index && index.packs) || {};
      const items = [];
      for (const key of Object.keys(packs)) {
        for (const item of (packs[key].items || [])) items.push(item);
      }
      stickerPack = items;
    } catch (_) {
      stickerPack = [];
    }
    return stickerPack;
  }

  function stickerSheet() {
    const items = stickerPack || [];
    if (!items.length) {
      openSheet(text('actions.stickers'), '<p class="lr-tip">'
        + esc(text('errors.offline')) + '</p>');
      loadStickers();
      return;
    }
    openSheet(text('actions.stickers'), '<div class="lr-stickergrid">'
      + items.map((item) => '<button type="button" data-sticker="' + esc(item.id) + '">'
        + '<img loading="lazy" alt="" src="' + STICKERS + esc(item.file) + '"></button>')
        .join('') + '</div>');
  }

  /** Shows one sticker over one seat, for as long as a shrug takes. */
  function popSticker(seat, id) {
    const node = el.pops && el.pops[seat];
    if (!node) return;
    const item = (stickerPack || []).find((entry) => entry.id === id);
    node.innerHTML = '<img alt="" src="' + STICKERS
      + esc(item ? item.file : id + '.webp') + '">';
    node.hidden = false;
    node.classList.remove('is-pop');
    void node.offsetWidth;          // let the animation start again from the top
    node.classList.add('is-pop');
    play('sticker', 0.45);
    window.clearTimeout(Number(node.dataset.timer || 0));
    const timer = window.setTimeout(() => { node.hidden = true; }, 2900);
    node.dataset.timer = String(timer);
  }

  /** Reads the room's chat for stickers nobody at this table has seen yet. */
  function readStickers() {
    if (!room || !Array.isArray(room.chat) || !table) return;
    let newest = stickerSeen;
    for (const line of room.chat) {
      const at = Number(line.at || 0);
      if (at <= stickerSeen || typeof line.text !== 'string') continue;
      newest = Math.max(newest, at);
      if (line.text.indexOf(STICKER_MARK) !== 0) continue;
      const id = line.text.slice(STICKER_MARK.length).trim();
      const seat = table.players.findIndex((person) => person.id === line.id);
      if (seat >= 0 && id) popSticker(seat, id);
    }
    stickerSeen = newest;
  }

  function loadStyle() {
    const href = stamp(ASSETS + '/ui/liar.css');
    if (document.querySelector('link[data-liar-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.liarStyle = '1';
    document.head.appendChild(link);
  }

  function unlockSound() {
    loadAudio();
    // لا ملء شاشة تلقائي عند أول لمسة — أمر المالك: ملء الشاشة بزرّه فقط.
    if (wentFull || !root) return;
    wentFull = true;
  }

  function lockPortrait() {
    try {
      const orientation = screen.orientation;
      if (orientation && orientation.lock) orientation.lock('portrait').catch(() => {});
    } catch (_) { /* not every platform allows it, and the prompt covers it */ }
  }

  function measure() {
    if (!root || !scene.ready) return;
    const box = root.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    const cap = quality === 'high' ? 2.4 : quality === 'balanced' ? 1.85 : 1.3;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (width !== scene.width || height !== scene.height || dpr !== scene.dpr) {
      resize(width, height, dpr);
    }
    // Two layouts, both designed rather than one stretched: upright for a
    // phone, wide for a laptop or a tablet turned on its side. The lens and
    // the camera follow from the same measurement, so turning the device
    // reframes the room without losing a card or a second of the round.
    root.dataset.layout = width > height * 1.15 ? 'wide' : 'tall';
  }

  function onKey(event) {
    if (!root) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (el.sheet && !el.sheet.hidden) el.sheet.hidden = true;
      else leaveSheet();
    }
    if (event.key === 'Enter' && table && table.canPlay && selected.size) throwSelected();
  }

  function onClick(event) {
    unlockSound();
    /* Anywhere off the card shuts it.
       A sheet that can only be dismissed by hitting a cross the size of a
       fingernail is a sheet you fight with, and the thumb is already halfway
       down the glass. The cross stays for whoever looks for it. */
    if (el.sheet && !el.sheet.hidden && event.target.closest('[data-sheet]')
        && !event.target.closest('.lr-sheet-card')) {
      closeSheet();
      return;
    }
    const chosen = event.target.closest('[data-sticker]');
    if (chosen) {
      el.sheet.hidden = true;
      call('say', { text: STICKER_MARK + chosen.dataset.sticker });
      return;
    }
    const who = event.target.closest('[data-char]');
    if (who) {
      if (who.classList.contains('is-locked')) {
        play('tap', 0.2);
        shout(text('errors.needPerks'));
        return;
      }
      play('tap', 0.35);
      call('character', editSeat === null ? { char: who.dataset.char }
        : { char: who.dataset.char, seat: editSeat });
      return;
    }
    const peekAt = event.target.closest('[data-peek]');
    if (peekAt) {
      closeSheet();
      call('peek', { target: Number(peekAt.dataset.peek) });
      return;
    }
    const chair = event.target.closest('[data-chair]');
    if (chair) {
      play('tap', 0.3);
      editSeat = chair.dataset.chair === 'me' ? null : Number(chair.dataset.chair);
      paintSetup();
      return;
    }
    const mode = event.target.closest('.lr-mode[data-mode]');
    if (mode) {
      play(mode.dataset.mode === 'royale' ? 'royale' : 'tap', 0.5);
      call('mode', { mode: mode.dataset.mode });
      return;
    }
    const chairs = event.target.closest('[data-seats]');
    if (chairs) {
      play('tap', 0.35);
      call('seats', { seats: Number(chairs.dataset.seats) });
      return;
    }
    if (event.target.closest('[data-do="startmatch"]')) {
      play('tap', 0.4);
      call('startmatch', {});
      return;
    }
    const pick = event.target.closest('[data-quality]');
    if (pick) { setQuality(pick.dataset.quality); return; }
    const button = event.target.closest('[data-do]');
    if (!button) return;
    const what = button.dataset.do;
    play('tap', 0.35);
    if (what === 'play') { throwSelected(); return; }
    if (what === 'challenge') { accuse(); return; }
    if (what === 'log') { logSheet(); return; }
    if (what === 'stickers') { stickerSheet(); return; }
    if (what === 'rules') { rulesSheet(); return; }
    if (what === 'more' || what === 'menu') { menuSheet(); return; }
    if (what === 'closesheet') { closeSheet(); return; }
    if (what === 'confirmleave') { el.sheet.hidden = true; leaveSheet(); return; }
    if (what === 'reallyleave') { el.sheet.hidden = true; call('leave'); return; }
    if (what === 'leave') { leaveSheet(); return; }
    if (what === 'invite') { el.sheet.hidden = true; call('invite'); return; }
    if (what === 'gift-peek') { peekSheet(); return; }
    if (what === 'gift-hawk') { play('gift', 0.6); call('hawk', {}); return; }
    if (what === 'view') {
      const order = watching() ? ['top', 'third'] : VIEWS;
      const at = order.indexOf(viewMode());
      viewPick = order[(at + 1) % order.length];
      try { localStorage.setItem('liar-view', viewPick); } catch (_) { /* a view is not worth a word */ }
      orbit.yaw = 0;
      orbit.pitch = 0;
      play('tap', 0.35);
      paintView();
      return;
    }
    if (what === 'recenter') {
      if (el.sheet) el.sheet.hidden = true;
      orbit.yaw = 0;
      orbit.pitch = 0;
      if (el.recenter) el.recenter.hidden = true;
      return;
    }
    if (what === 'chat') { chatSheet(); return; }
    if (what === 'sendchat') {
      const field = el.sheet.querySelector('[data-chatline]');
      const line = field ? String(field.value || '').trim().slice(0, 140) : '';
      el.sheet.hidden = true;
      if (line) call('say', { text: line });
      return;
    }
    if (what === 'rematch') { selected.clear(); clearStage(); call('rematch'); return; }
    if (what === 'mic') {
      // The room owns the microphone; the table only asks for it. The button
      // is repainted from the room's own answer on the next state, so it
      // never claims to be open before it is.
      if (el.sheet) el.sheet.hidden = true;
      call('mic');
      return;
    }
    if (what === 'laugh') { call('say', { text: text('actions.laugh') }); return; }
    if (what === 'sound') { setMute(!mute); moreSheet(); return; }
  }

  function setMute(value) {
    mute = !!value;
    try { localStorage.setItem(MUTE_KEY, mute ? '1' : '0'); } catch (_) { /* private mode */ }
  }

  function setQuality(value) {
    if (QUALITIES.indexOf(value) < 0 || value === quality) return;
    quality = value;
    try { localStorage.setItem(QUALITY_KEY, value); } catch (_) { /* private mode */ }
    if (el.sheet) el.sheet.hidden = true;
    measure();
  }

  function readSettings() {
    try {
      mute = localStorage.getItem(MUTE_KEY) === '1';
      const saved = localStorage.getItem(QUALITY_KEY);
      if (QUALITIES.indexOf(saved) >= 0) quality = saved;
    } catch (_) { /* private mode keeps the defaults */ }
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function tickClock() {
    if (!running) return;
    paintClock();
    tellCup();
    window.setTimeout(tickClock, 240);
  }

  async function start() {
    readSettings();
    loadStyle();
    words = await fetch(stamp(ASSETS + '/locale/ar.json'), { cache: 'force-cache' })
      .then((response) => response.json()).catch(() => ({}));
    ICONS = stamp(ASSETS + '/ui/icons.svg');
    PERK_ICON = stamp(ASSETS + '/art/perk.webp');
    root.innerHTML = skeleton();
    el.root = root;
    el.canvas = root.querySelector('.lr-stage');
    el.hint = root.querySelector('[data-hint]');
    el.play = root.querySelector('.lr-play');
    el.playLabel = root.querySelector('[data-playlabel]');
    el.liar = root.querySelector('.lr-liar');
    el.call = root.querySelector('[data-call]');
    el.room = root.querySelector('[data-room]');
    el.round = root.querySelector('[data-round]');
    el.error = root.querySelector('.lr-error');
    el.sheet = root.querySelector('[data-sheet]');
    el.sheetTitle = root.querySelector('[data-sheet-title]');
    el.sheetBody = root.querySelector('[data-sheet-body]');
    el.mic = root.querySelector('.lr-rail [data-do="mic"]');
    el.recenter = root.querySelector('.lr-rail [data-do="recenter"]');
    el.viewBtn = root.querySelector('.lr-rail [data-do="view"]');
    el.royaleBanner = root.querySelector('[data-royalebanner]');
    el.gift = root.querySelector('[data-gift]');
    el.giftSense = root.querySelector('[data-giftsense]');
    el.giftSaw = root.querySelector('[data-giftsaw]');
    el.giftPeek = root.querySelector('[data-do="gift-peek"]');
    el.giftHawk = root.querySelector('[data-do="gift-hawk"]');
    const giftIcon = root.querySelector('[data-gifticon]');
    if (giftIcon) giftIcon.src = PERK_ICON;
    if (el.recenter) el.recenter.hidden = true;
    el.loading = root.querySelector('[data-loading]');
    el.stagecard = root.querySelector('[data-stagecard]');
    el.myturn = root.querySelector('[data-myturn]');
    el.setup = root.querySelector('[data-setup]');
    el.seatpick = root.querySelector('[data-seatpick]');
    el.setupDeck = root.querySelector('[data-setupdeck]');
    el.setupWait = root.querySelector('[data-setupwait]');
    el.setupStart = root.querySelector('[data-do="startmatch"]');

    el.plateHolder = root.querySelector('[data-plates]');
    el.popHolder = root.querySelector('[data-pops]');
    el.whopick = root.querySelector('[data-whopick]');
    el.modepick = root.querySelector('[data-modepick]');
    el.chairs = root.querySelector('[data-chairs]');
    el.whohint = root.querySelector('[data-whohint]');
    el.seatsTitle = root.querySelector('[data-seatstitle]');
    ensurePlates(4);
    loadStickers();

    await buildScene(el.canvas, quality);
    el.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      scene.lost = true;
    });
    el.canvas.addEventListener('webglcontextrestored', () => {
      buildScene(el.canvas, quality).then(() => { scene.lost = false; measure(); });
    });
    el.canvas.addEventListener('pointerdown', onDown, { passive: false });
    el.canvas.addEventListener('pointermove', onMove, { passive: false });
    el.canvas.addEventListener('pointerup', onUp, { passive: false });
    el.canvas.addEventListener('pointercancel', onUp, { passive: false });
    root.addEventListener('click', onClick);
    /* The room swallows every gesture on purpose — the whole surface is a
       camera — so anything laid over it has to be handed its own scrolling
       back, by the wheel and by a dragged finger both. */
    letScroll(el.sheet, '.lr-sheet-card');
    letScroll(el.setup, '.lr-setup-card');
    document.addEventListener('keydown', onKey);
    observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('orientationchange', measure);
    document.addEventListener('visibilitychange', onVisible);

    ready = true;
    el.loading.hidden = true;
    root.classList.add('is-live');
    measure();
    running = true;
    frame = performance.now() / 1000;
    started = frame;
    requestAnimationFrame(render);
    tickClock();
    if (queued) { const held = queued; queued = null; paint(held.view, held.roomInfo); }
  }

  function onVisible() {
    if (document.hidden) {
      running = false;
    } else if (root && ready && !running) {
      running = true;
      frame = performance.now() / 1000;
      requestAnimationFrame(render);
      tickClock();
    }
  }

  function mount(host) {
    if (root && root.isConnected && root.parentNode === host) return;
    if (root) reset();
    root = document.createElement('div');
    root.className = 'lr-root';
    root.dir = 'rtl';
    host.appendChild(root);
    document.body.classList.add('lr-playing');
    start().catch(() => {
      if (!root) return;
      root.classList.add('is-broken');
      const note = root.querySelector('[data-loading] b');
      if (note) note.textContent = text('errors.offline') || '';
    });
  }

  function reset() {
    running = false;
    ready = false;
    queued = null;
    table = null;
    room = null;
    pile = [];
    flights = [];
    ceremony = null;
    handCards = [];
    selected.clear();
    shownRev = -1; shownPhase = ''; shownLast = ''; shownRound = -1;
    stickerSeen = 0;
    handShown = 0;
    grab = null;
    talking = new Set();
    for (let i = 0; i < 5; i++) { moods[i] = newMood(); bubbles[i] = null; }
    if (observer) { observer.disconnect(); observer = null; }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('orientationchange', measure);
    if (document.fullscreenElement && root && document.fullscreenElement === root) {
      try { document.exitFullscreen(); } catch (_) { /* already leaving */ }
    }
    wentFull = false;
    scene.ready = false;
    scene.gl = null;
    if (root) root.remove();
    root = null;
    for (const key of Object.keys(el)) delete el[key];
    document.body.classList.remove('lr-playing');
  }

  window.ShahdLiar = {
    supports: (game) => game === 'liar',
    /** يوقظ محرّك الصوت بعد أن يقطعه فتح المايك أو رجوع التطبيق من الخلفية. */
    unlockAudio: unlockSound,
    voice: (ids) => {
      if (!root || !table) return;
      const next = new Set(ids || []);
      if (next.size === talking.size
        && Array.from(next).every((id) => talking.has(id))) return;
      talking = next;
      paintPlates();
    },
    mount,
    paint,
    bind: (fn) => { send = fn; },
    reset,
  };
})();
