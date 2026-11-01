/* ════════════════════════════════════════════════════════════════════
   PLAYLIST EDIT MODE  (window.plEdit)
   - 플레이리스트 상세의 곡 행을 길게 누르면 편집 상태로 진입
   - 편집 중인 행 옆에 컨텍스트 메뉴(즐겨찾기 / 곡 삭제) — 앱에서는 Compose Liquid Glass(EditMenuGlass)가 그린다
   - 편집 중인 행은 드래그로 순서 변경: 리스트 영역 밖으로 나가지 못하고, 다른 곡들은 순차적으로 부드럽게 자리를 비켜 준다
   app.js 는 plRenderDetail / gv / applyTrackUi 에서 exit() / syncPlaying() 만 호출한다 (이벤트는 목록 컨테이너에 위임).
════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const list = document.getElementById('pl-track-list');
    if (!list) return;

    const LONG_MS = 420;       // 롱프레스 시간
    const SLOP = 9;            // 롱프레스 취소 이동 허용치(px)
    const MENU_H = 108;        // #pl-edit-menu 높이(CSS: 46*2 + 6*2 + border 와 일치)
    const DOCK_H = 150;        // 하단 도크가 차지하는 높이(메뉴가 가려지지 않도록 위로 뒤집는 기준)
    const root = document.documentElement;

    const E = {
        on: false, row: null,
        press: null,           // 롱프레스 대기 {row,x,y,timer}
        drag: null,            // 드래그 상태
        menu: null,
        settleT: 0
    };

    const rows = () => Array.prototype.filter.call(list.children, el => el.classList && el.classList.contains('pl-track'));
    const curPl = () => (typeof plById === 'function' ? plById(PL.curId) : null);
    const kick = ms => { try { window.__glassKick && window.__glassKick(ms || 450); } catch (e) { } };
    const haptic = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { } };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    /* ─────────────── 메뉴 ─────────────── */
    function ensureMenu() {
        if (E.menu) return E.menu;
        const m = document.createElement('div');
        m.id = 'pl-edit-menu';
        m.innerHTML =
            '<button type="button" class="pl-em-item" data-act="fav">' +
            '<svg width="18" height="18" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">' +
            '<path d="M7.5 12.5S2 8.8 2 5.5a3 3 0 0 1 5.5-1.65A3 3 0 0 1 13 5.5C13 8.8 7.5 12.5 7.5 12.5z"/></svg>' +
            '<span class="pl-em-lab">즐겨찾기</span></button>' +
            '<button type="button" class="pl-em-item pl-em-del" data-act="del">' +
            '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2M7 7v4M9 7v4"/></svg>' +
            '<span class="pl-em-lab">곡 삭제</span></button>';
        m.addEventListener('click', e => {
            const b = e.target.closest('.pl-em-item');
            e.stopPropagation();
            if (b) act(b.dataset.act);
        });
        E.menu = m;
        return m;
    }

    function trackOf(row) {
        const pl = curPl();
        return pl ? pl.tracks.find(t => t.id === row.dataset.id) : null;
    }

    function syncMenu() {
        if (!E.on || !E.menu || !E.row) return;
        const fav = E.menu.querySelector('[data-act="fav"]');
        const on = typeof isFav === 'function' && isFav(E.row.dataset.id);
        fav.classList.toggle('on', on);
        fav.querySelector('.pl-em-lab').textContent = on ? '즐겨찾기 해제' : '즐겨찾기';
    }

    /** 메뉴를 행 아래에 두되, 아래에 공간이 없으면(하단 도크) 위로 뒤집는다. 행 자식이라 스크롤/이동을 그대로 따라간다. */
    function placeMenu() {
        if (!E.on || !E.row || !E.menu) return;
        const r = E.row.getBoundingClientRect();
        const needBelow = r.bottom + 6 + MENU_H > innerHeight - DOCK_H;
        const fitsAbove = r.top - 6 - MENU_H > 64;
        E.menu.classList.toggle('up', needBelow && fitsAbove);
    }

    function act(a) {
        if (!E.on || !E.row) return;
        if (a === 'fav') {
            const t = trackOf(E.row);
            if (t && typeof toggleFavTrack === 'function') toggleFavTrack(t);
            syncMenu(); kick(300);
        } else if (a === 'del') {
            removeEditing();
        } else if (a === 'done') {
            exit();
        }
    }

    /* ─────────────── 진입/종료 ─────────────── */
    function enter(row) {
        if (E.on && E.row === row) return;
        if (E.on) leaveRow();
        E.on = true; E.row = row;
        root.classList.add('pl-editing');
        list.classList.add('editing');
        row.classList.add('editing');
        row.appendChild(ensureMenu());
        syncMenu(); placeMenu();
        row.addEventListener('touchmove', onRowTouchMove, { passive: false });
        haptic();
        kick(500);
    }

    function leaveRow() {
        const row = E.row;
        if (row) {
            row.removeEventListener('touchmove', onRowTouchMove);
            row.classList.remove('editing', 'dragging', 'dropping');
            row.style.transform = ''; row.style.transitionDelay = '';
        }
        if (E.menu && E.menu.parentNode) E.menu.parentNode.removeChild(E.menu);
        E.row = null;
    }

    function exit(force) {
        cancelPress();
        if (E.drag) { if (!force) return; abortDrag(); }
        if (!E.on) return;
        leaveRow();
        E.on = false;
        root.classList.remove('pl-editing');
        list.classList.remove('editing');
        kick(400);
    }

    /* ─────────────── 롱프레스 ─────────────── */
    function cancelPress() {
        if (E.press) { clearTimeout(E.press.timer); E.press = null; }
    }

    list.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) { cancelPress(); return; }
        const row = e.target.closest && e.target.closest('.pl-track');
        if (!row || row.parentNode !== list) return;
        const t = e.touches[0];
        if (E.on) {
            // 편집 중인 행에서 다시 누르면 곧바로 드래그 대기 (touch-action: none 이므로 스크롤과 충돌하지 않는다)
            if (row === E.row && !e.target.closest('#pl-edit-menu')) E.drag = pendingDrag(t.clientX, t.clientY);
            return;
        }
        if (e.target.closest('.pl-track-del')) return;
        const p = E.press = { row: row, x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, timer: 0 };
        p.timer = setTimeout(() => {
            if (E.press !== p) return;
            E.press = null;
            enter(row);
            // 같은 제스처를 이어서 드래그할 수 있게 대기 상태로 전환
            E.drag = pendingDrag(p.lx, p.ly);
        }, LONG_MS);
    }, { passive: true });

    list.addEventListener('touchmove', e => {
        const p = E.press; if (!p) return;
        const t = e.touches[0];
        p.lx = t.clientX; p.ly = t.clientY;
        if (Math.abs(t.clientX - p.x) > SLOP || Math.abs(t.clientY - p.y) > SLOP) cancelPress();
    }, { passive: true });

    ['touchend', 'touchcancel'].forEach(ev => list.addEventListener(ev, () => {
        cancelPress();
        if (E.drag) endDrag();
    }, { passive: true }));

    // 마우스(개발용 브라우저)
    list.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const row = e.target.closest && e.target.closest('.pl-track');
        if (!row || row.parentNode !== list) return;
        if (E.on) {
            if (row === E.row && !e.target.closest('#pl-edit-menu')) E.drag = pendingDrag(e.clientX, e.clientY);
            return;
        }
        if (e.target.closest('.pl-track-del')) return;
        const p = E.press = { row: row, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, timer: 0 };
        p.timer = setTimeout(() => { if (E.press !== p) return; E.press = null; enter(row); E.drag = pendingDrag(p.lx, p.ly); }, LONG_MS);
    });
    window.addEventListener('mousemove', e => {
        if (E.press) {
            E.press.lx = e.clientX; E.press.ly = e.clientY;
            if (Math.abs(e.clientX - E.press.x) > SLOP || Math.abs(e.clientY - E.press.y) > SLOP) cancelPress();
        }
        if (E.drag) moveDrag(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => { cancelPress(); if (E.drag) endDrag(); });

    // 시스템 롱프레스 메뉴(이미지 저장/텍스트 선택) 차단
    list.addEventListener('contextmenu', e => e.preventDefault());

    // 스크롤이 시작되면 롱프레스 취소 + 멈추면 메뉴 위치(위/아래) 재판단
    window.addEventListener('scroll', () => {
        if (E.press) cancelPress();
        if (!E.on) return;
        clearTimeout(E.settleT);
        E.settleT = setTimeout(() => { placeMenu(); kick(300); }, 140);
    }, { passive: true });

    /* 편집 중 클릭 가로채기: 편집 행/메뉴 밖을 탭하면 편집만 종료(곡이 재생되지 않는다) */
    list.addEventListener('click', e => {
        if (!E.on) return;
        if (e.target.closest('#pl-edit-menu')) return;      // 메뉴는 자체 핸들러가 처리
        e.preventDefault(); e.stopPropagation();
        const row = e.target.closest('.pl-track');
        if (row !== E.row) exit();
    }, true);
    // 목록 바깥을 눌러도 편집 종료 (상단 버튼/헤더 등)
    document.addEventListener('click', e => {
        if (E.on && !e.target.closest('#pl-track-list')) exit();
    }, true);

    /* ─────────────── 드래그(순서 변경) ─────────────── */
    function pendingDrag(x, y) {
        return { pending: true, x0: x, y0: y, x: x, y: y };
    }

    function onRowTouchMove(e) {
        const d = E.drag; if (!d) return;
        const t = e.touches[0];
        if (d.pending) {
            if (Math.abs(t.clientY - d.y0) < 6 && Math.abs(t.clientX - d.x0) < 6) return;
            if (!e.cancelable) { E.drag = null; return; }       // 브라우저가 이미 스크롤을 시작함 → 드래그 포기
            beginDrag(t.clientY);
        }
        if (e.cancelable) e.preventDefault();                   // 드래그 중 문서 스크롤 차단
        moveDrag(t.clientX, t.clientY);
    }

    function beginDrag(y) {
        const row = E.row, rs = rows(), from = rs.indexOf(row);
        if (from < 0) { E.drag = null; return; }
        const startY = E.drag && E.drag.pending ? E.drag.y0 : y;   // 손가락이 처음 닿은 지점 기준 → 행이 손가락과 1:1 로 붙는다
        const geo = rs.map(r => ({ top: r.offsetTop, h: r.offsetHeight }));
        const gap = rs.length > 1 ? Math.max(0, geo[1].top - (geo[0].top + geo[0].h)) : 0;
        const first = geo[0].top, last = geo[geo.length - 1].top + geo[geo.length - 1].h;
        E.drag = {
            pending: false, rs: rs, geo: geo, gap: gap, from: from, to: from, prevTo: from,
            y0: startY, y: y, scroll0: window.scrollY || 0,
            minT: first - geo[from].top,                    // 리스트 맨 위 칸 밖으로 못 나감
            maxT: last - geo[from].h - geo[from].top,       // 리스트 맨 아래 칸 밖으로 못 나감
            ty: 0, raf: 0, order: null
        };
        row.classList.remove('dropping');
        row.classList.add('dragging');
        list.classList.add('reordering');
        rs.forEach(r => { if (r !== row) r.style.transitionDelay = '0ms'; });
        haptic();
        kick(300);
        E.drag.raf = requestAnimationFrame(frame);
    }

    function moveDrag(x, y) {
        const d = E.drag; if (!d) return;
        d.x = x; d.y = y;
        if (d.pending) {
            if (Math.abs(y - d.y0) > 6) beginDrag(y);   // (마우스 경로)
        }
    }

    /** 프레임당 1회: 손가락 추종 + 자동 스크롤 + 목표 칸 계산 */
    function frame() {
        const d = E.drag; if (!d || d.pending) return;
        d.raf = requestAnimationFrame(frame);

        // 화면 위/아래 가장자리에서 자동 스크롤
        const topEdge = 96, botEdge = innerHeight - DOCK_H + 40;
        let v = 0;
        if (d.y < topEdge) v = -Math.ceil((topEdge - d.y) / 7);
        else if (d.y > botEdge) v = Math.ceil((d.y - botEdge) / 7);
        v = clamp(v, -16, 16);
        if (v) window.scrollBy(0, v);

        const dy = (d.y - d.y0) + ((window.scrollY || 0) - d.scroll0);
        const ty = clamp(dy, d.minT, d.maxT);               // ← 리스트 범위 제한
        if (ty !== d.ty || d.first !== true) {
            d.ty = ty; d.first = true;
            d.rs[d.from].style.transform = 'translate3d(0,' + ty + 'px,0) scale(1.025)';
        }

        // 드래그 행의 중심이 어느 칸에 있는지: 다른 행들의 \"원래 중심\" 중 위에 있는 개수
        const center = d.geo[d.from].top + ty + d.geo[d.from].h / 2;
        let to = 0;
        for (let k = 0; k < d.geo.length; k++) {
            if (k === d.from) continue;
            if (d.geo[k].top + d.geo[k].h / 2 < center) to++;
        }
        if (to !== d.to) { d.prevTo = d.to; d.to = to; layoutOthers(d); }
    }

    /** to 칸에 드래그 행이 들어갔을 때의 모든 행 위치 → 다른 행들은 정확히 그 칸으로 이동 (칸 단위 → 겹침 불가) */
    function slotTops(d, to) {
        const others = [];
        for (let k = 0; k < d.geo.length; k++) if (k !== d.from) others.push(k);
        const order = others.slice(); order.splice(to, 0, d.from);
        const tops = new Array(d.geo.length);
        let pos = d.geo[0].top;
        order.forEach(k => { tops[k] = pos; pos += d.geo[k].h + d.gap; });
        return tops;
    }

    function layoutOthers(d) {
        const tops = slotTops(d, d.to);
        d.order = tops;
        const nNow = Math.abs(d.to - d.from), nPrev = Math.abs(d.prevTo - d.from);
        for (let k = 0; k < d.rs.length; k++) {
            if (k === d.from) continue;
            const r = d.rs[k];
            const off = tops[k] - d.geo[k].top;
            const dist = Math.abs(k - d.from) - 1;               // 0 = 드래그 시작 칸에 가장 가까운 행
            // 자리를 비켜 줄 때는 가까운 행부터, 제자리로 돌아올 때는 먼 행부터 → 뒤따르는 행이 항상 뒤처져 겹치지 않는다
            const reverting = off === 0;
            const step = reverting ? Math.max(0, nPrev - 1 - dist) : dist;
            r.style.transitionDelay = Math.min(step * 16, 96) + 'ms';
            r.style.transform = off ? 'translate3d(0,' + off + 'px,0)' : '';
        }
    }

    function endDrag() {
        const d = E.drag;
        if (!d) return;
        if (d.pending) { E.drag = null; return; }              // 움직이지 않고 뗌 → 편집 상태만 유지
        cancelAnimationFrame(d.raf);
        E.drag = null;

        const row = d.rs[d.from];
        const tops = d.order || slotTops(d, d.from);
        const slotOff = tops[d.from] - d.geo[d.from].top;
        row.classList.add('dropping');
        row.style.transform = 'translate3d(0,' + slotOff + 'px,0) scale(1)';
        const finish = () => commitOrder(d);
        let done = false;
        const once = () => { if (done) return; done = true; row.removeEventListener('transitionend', onEnd); finish(); };
        const onEnd = ev => { if (ev.target === row && ev.propertyName === 'transform') once(); };
        row.addEventListener('transitionend', onEnd);
        setTimeout(once, 340);                                 // 안전망
    }

    function abortDrag() {
        const d = E.drag; E.drag = null;
        if (!d || d.pending) return;
        cancelAnimationFrame(d.raf);
        d.rs.forEach(r => { r.style.transform = ''; r.style.transitionDelay = ''; r.classList.remove('dragging', 'dropping'); });
        list.classList.remove('reordering');
    }

    /** 애니메이션이 끝난 뒤: 데이터/DOM 을 실제 순서로 확정한다(전환 없이 → 깜빡임 없음) */
    function commitOrder(d) {
        const pl = curPl();
        const row = d.rs[d.from];
        list.classList.add('no-anim');
        if (pl && d.to !== d.from && pl.tracks[d.from] && pl.tracks[d.from].id === row.dataset.id) {
            const before = pl.tracks.slice();
            const t = pl.tracks.splice(d.from, 1)[0];
            pl.tracks.splice(d.to, 0, t);
            plSave();
            const others = d.rs.filter(r => r !== row);
            list.insertBefore(row, others[d.to] || null);
            fixQueueAfterEdit(before, pl.tracks);
        }
        d.rs.forEach(r => { r.style.transform = ''; r.style.transitionDelay = ''; });
        row.classList.remove('dragging', 'dropping');
        list.classList.remove('reordering');
        renumber();
        void list.offsetHeight;                                // 전환 없이 스타일 확정
        requestAnimationFrame(() => list.classList.remove('no-anim'));
        placeMenu();
        kick(500);
    }

    function renumber() {
        rows().forEach((r, i) => {
            const n = r.querySelector('.pl-track-num');
            const s = String(i + 1);
            if (n && n.textContent !== s) n.textContent = s;
        });
    }

    /* ─────────────── 삭제 ─────────────── */
    function removeEditing() {
        const row = E.row, pl = curPl();
        if (!row || !pl) return;
        const idx = rows().indexOf(row);
        if (idx < 0 || !pl.tracks[idx] || pl.tracks[idx].id !== row.dataset.id) return;
        const before = pl.tracks.slice();
        const removed = pl.tracks.splice(idx, 1)[0];
        plSave();
        fixQueueAfterEdit(before, pl.tracks, removed);

        exit(true);                                            // 메뉴/편집 상태 먼저 정리 (메뉴는 행의 자식이므로 함께 분리됨)
        row.style.height = row.offsetHeight + 'px';
        void row.offsetHeight;
        row.classList.add('removing');
        const after = () => {
            row.remove();
            renumber();
            if (!pl.tracks.length) { if (typeof plRenderDetail === 'function') plRenderDetail(pl.id); }
            else refreshHeader(pl);
            kick(300);
        };
        let done = false;
        const once = () => { if (done) return; done = true; after(); };
        row.addEventListener('transitionend', ev => { if (ev.target === row && ev.propertyName === 'height') once(); });
        setTimeout(once, 360);
        if (typeof toast === 'function') toast('곡을 삭제했어요');
    }

    function refreshHeader(pl) {
        const cnt = document.getElementById('pl-detail-count');
        if (cnt) cnt.textContent = pl.tracks.length + '곡';
        const cover = document.getElementById('pl-detail-cover');
        if (!cover || typeof trackThumbSrc !== 'function') return;
        const thumbs = pl.tracks.slice(0, 4).map(t => trackThumbSrc(t));
        cover.className = 'pl-detail-cover' + (thumbs.length === 1 ? ' single' : '');
        cover.innerHTML = thumbs.map(src => '<img src="' + esc(src) + '" alt="">').join('');
    }

    /** 재생 대기열이 이 플레이리스트에서 만들어진 것(같은 곡 집합)이면 새 순서/삭제를 대기열에도 반영 */
    function fixQueueAfterEdit(before, after, removed) {
        if (!Array.isArray(S.q) || S.q.length !== before.length) return;
        const ids = new Set(before.map(t => t.id));
        if (!S.q.every(t => ids.has(t.id))) return;
        const curId = S.track && S.track.id;
        const oldCur = S.q.findIndex(t => t.id === curId);
        S.q = after.slice();
        const ni = S.q.findIndex(t => t.id === curId);
        if (ni >= 0) S.idx = ni;
        else S.idx = Math.min(Math.max(oldCur - 1, -1), S.q.length - 1);   // 재생 중이던 곡을 지웠다면 다음 곡부터 이어지도록
        if (document.getElementById('v-queue') && document.getElementById('v-queue').classList.contains('on') && typeof renderQueue === 'function') renderQueue();
    }

    /* ─────────────── 하이라이트(현재 재생 곡) ─────────────── */
    /** DOM 을 다시 만들지 않고, 곡 id 로 정확히 한 행만 '재생 중' 으로 표시한다 (이전 곡이 남던 문제 해결). */
    function syncPlaying() {
        const id = S.track && S.track.id;
        const rs = list.children;
        for (let i = 0; i < rs.length; i++) {
            const r = rs[i];
            if (!r.classList || !r.classList.contains('pl-track')) continue;
            const on = !!id && r.dataset.id === id;
            if (r.classList.contains('playing') !== on) r.classList.toggle('playing', on);
        }
    }

    window.plEdit = {
        exit: exit,
        isOn: () => E.on,
        act: act,
        syncPlaying: syncPlaying,
        _state: E
    };
})();
