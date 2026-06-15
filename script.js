// Debug Logger
function logDebug(msg) {
    console.log(msg);
    const d = document.getElementById('debug-log');
    if(d) d.innerHTML += '<div>' + msg + '</div>';
}
window.addEventListener('error', function(e) { logDebug('❌ ERROR: ' + e.message); });
logDebug('시스템 초기화 중...');

let scene, camera, renderer, cylinders = [];
let isDragging = false, dragStartX = 0, dragStartRotation = 0, activeCylinderIndex = -1;
let isHovering = false; 
let lastInteractionTime = 0; 
let pauseAutoDuration = 10000; 
let pointerStartTime = 0, pointerStartPos = { x: 0, y: 0 }; 
const ITEM_COUNT = 20; 
const CYLINDER_RADIUS = 0.87;
let isLocked = false; // 전시 모드 잠금 여부
const SLOT_WIDTH = (2 * Math.PI * CYLINDER_RADIUS) / ITEM_COUNT;
const ROTATION_STEP = (Math.PI * 2) / ITEM_COUNT;

let CATEGORIES = [
    { id: 0, name: 'HAT', items: [] }, { id: 1, name: 'ACC', items: [] }, 
    { id: 2, name: 'TOP', items: [] }, { id: 3, name: 'BOTTOM', items: [] }, 
    { id: 4, name: 'SHOES', items: [] }
];
let STYLE_SETS = [{ id: 1, name: 'STYLING 1' }];
let editingSetId = null;

function getCylinderHeight(index) {
    let h = 7.0; 
    if (index === 0) h = 8.5; // HAT
    else if (index === 1) h = 5.0; // ACC (신규)
    else if (index === 2) h = 18.0; // TOP
    else if (index === 3) h = 20.0; // BOTTOM
    else if (index === 4) h = 7.0; // SHOES
    return SLOT_WIDTH * (h / 16); 
}

async function init() {
    try {
        scene = new THREE.Scene(); 
        scene.background = null; // CSS 배경이 보이도록 투명 설정
        scene.fog = new THREE.Fog(0x050505, 10, 50); // 깊이감 있는 블랙 포그
        camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000); 
        camera.position.set(0, 0, 3); // 카메라 거리 Z=3으로 다시 당김
        
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); 
        renderer.setSize(window.innerWidth, window.innerHeight); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
        document.getElementById('canvas-container').appendChild(renderer.domElement);
        
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const L2 = new THREE.DirectionalLight(0xffffff, 0.8); L2.position.set(10, 20, 10); scene.add(L2);
        
        for (let i = 0; i < CATEGORIES.length; i++) {
            const cyl = await createCylinderMesh(i); scene.add(cyl.group); cylinders.push(cyl);
        }
        await loadEverything();
    } catch (error) { 
        logDebug('❌ INIT FAIL: ' + error.message); 
    } finally { 
        setTimeout(hideLoader, 1000); 
    }
    
    window.addEventListener('resize', () => { 
        camera.aspect = window.innerWidth / window.innerHeight; 
        camera.updateProjectionMatrix(); 
        renderer.setSize(window.innerWidth, window.innerHeight); 
    });
    
    const cont = document.getElementById('canvas-container');
    cont.addEventListener('pointerdown', onPointerDown); 
    window.addEventListener('pointermove', onPointerMove); 
    window.addEventListener('pointerup', onPointerUp);
    
    animate();

    // 캐러셀 스크롤 시 도트 업데이트 연결
    const styleView = document.getElementById('style-carousel');
    styleView.addEventListener('scroll', updateActiveDot);
}

async function loadEverything() {
    let dataToLoad = null;
    
    // 1. 우선 순위: 파일 내부에 데이터가 있는 경우 (EMBEDDED_DATA)
    if (window.EMBEDDED_DATA) {
        dataToLoad = window.EMBEDDED_DATA;
        CATEGORIES = dataToLoad.categories || CATEGORIES;
        STYLE_SETS = dataToLoad.sets || STYLE_SETS;
    } 
    // 2. 차순위: 브라우저 저장소 (localStorage)
    else {
        const imgs = localStorage.getItem('fm_imgs');
        const sets = localStorage.getItem('fm_sets');
        if (imgs) {
            let loaded = JSON.parse(imgs);
            CATEGORIES = CATEGORIES.map((cat, i) => {
                const found = loaded.find(lc => lc.name === cat.name);
                return found ? { ...cat, items: found.items } : cat;
            });
        }
        if (sets) STYLE_SETS = JSON.parse(sets);
        
        const rots = JSON.parse(localStorage.getItem('fm_rots'));
        dataToLoad = { rotations: rots };
    }
    
    // 엔진에 데이터 반영
    const currentRots = dataToLoad.rotations || [];
    for (let i = 0; i < CATEGORIES.length; i++) {
        await updateCylinderTexture(i);
        if (currentRots[i] !== undefined) {
            cylinders[i].targetRotation = currentRots[i];
            cylinders[i].group.rotation.y = currentRots[i];
        }
    }
    
    updateTopCarousel(); 
    createUI();
    updateStorageStatus(); // 상태 표시줄 업데이트
}

function animate() { 
    requestAnimationFrame(animate); 
    cylinders.forEach((c) => { 
        const now = Date.now();
        if (!isDragging && !isHovering && (now - lastInteractionTime > pauseAutoDuration)) {
            c.targetRotation += c.autoSpeed;
        }
        c.group.rotation.y += (c.targetRotation - c.group.rotation.y) * 0.12; 
    }); 
    renderer.render(scene, camera); 
}

async function createCylinderMesh(index) {
    const h = getCylinderHeight(index); const group = new THREE.Group(); 
    let yPos = 0; 
    const hs = [getCylinderHeight(0), getCylinderHeight(1), getCylinderHeight(2), getCylinderHeight(3), getCylinderHeight(4)];
    const totalH = hs.reduce((a, b) => a + b, 0);
    const top = totalH / 2;
    
    let currentY = top;
    for (let i = 0; i < index; i++) currentY -= hs[i];
    yPos = currentY - h / 2;
    
    group.position.y = yPos;
    
    const geo = new THREE.CylinderGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS, h, 160, 1, true);
    const mat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide });
    
    mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
            #ifdef USE_MAP
                float dotFront = dot(vNormal, vec3(0, 0, 1));
                float centerWeight = abs(dotFront);
                float blurDist = mix(0.012, 0.0, smoothstep(0.7, 0.98, centerWeight)); 
                float darkness = mix(0.25, 1.0, smoothstep(0.6, 1.0, centerWeight));
                vec4 foggyColor = vec4(0.0);
                if (blurDist > 0.0) {
                    foggyColor += texture2D(map, vUv) * 0.16;
                    foggyColor += texture2D(map, vUv + vec2(blurDist, 0.0)) * 0.15;
                    foggyColor += texture2D(map, vUv + vec2(-blurDist, 0.0)) * 0.15;
                    foggyColor += texture2D(map, vUv + vec2(0.0, blurDist)) * 0.15;
                    foggyColor += texture2D(map, vUv + vec2(0.0, -blurDist)) * 0.15;
                } else { foggyColor = texture2D(map, vUv); }
                foggyColor.rgb *= darkness;
                float mask = smoothstep(0.95, 0.99, centerWeight); 
                diffuseColor = mix(foggyColor, texture2D(map, vUv), mask);
            #endif
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
            #include <dithering_fragment>
            #ifdef USE_MAP
                float omMask = smoothstep(0.97, 0.995, abs(dot(vNormal, vec3(0, 0, 1))));
                if (omMask > 0.02) { gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(map, vUv).rgb, omMask); }
            #endif
        `);
    };

    const mesh = new THREE.Mesh(geo, mat); mesh.rotation.y = - (ROTATION_STEP / 2); group.add(mesh);
    const autoSpeed = (Math.random() * 0.0008 + 0.0002) * (Math.random() > 0.5 ? 1 : -1);
    const obj = { group, mesh, h, targetRotation: 0, autoSpeed }; 
    cylinders[index] = obj; return obj;
}

async function updateCylinderTexture(index) {
    let hVal = 7.0; 
    if (index === 0) hVal = 8.5; 
    else if (index === 1) hVal = 5.0; 
    else if (index === 2) hVal = 18.0; 
    else if (index === 3) hVal = 20.0;
    else if (index === 4) hVal = 7.0;
    const hRatio = hVal / 16; 
    const MAX_WIDTH = 8192; 
    const canvas = document.createElement('canvas'); canvas.width = MAX_WIDTH; canvas.height = Math.round((MAX_WIDTH / ITEM_COUNT) * hRatio);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sW = canvas.width / ITEM_COUNT, sH = canvas.height;
    
    await Promise.all(CATEGORIES[index].items.map((item, i) => new Promise(res => {
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = item.url;
        img.onload = () => {
            const scale = Math.max(sW / img.width, sH / img.height);
            const dW = img.width * scale, dH = img.height * scale;
            ctx.save(); ctx.beginPath(); ctx.rect(i * sW, 0, sW, sH); ctx.clip();
            ctx.drawImage(img, (i * sW) + (sW - dW)/2, (sH - dH)/2, dW, dH); ctx.restore(); res();
        }; img.onerror = () => res();
    })));
    
    const tex = new THREE.CanvasTexture(canvas); 
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.anisotropy = maxAnisotropy;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    
    cylinders[index].mesh.material.map = tex; cylinders[index].mesh.material.needsUpdate = true;
}

function onPointerDown(e) {
    pointerStartTime = Date.now(); pointerStartPos = { x: e.clientX, y: e.clientY };
    const m = new THREE.Vector2((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
    const r = new THREE.Raycaster(); r.setFromCamera(m, camera); const h = r.intersectObjects(scene.children, true);
    if (h.length) {
        let o = h[0].object; while(o.parent && !scene.children.includes(o)) o = o.parent;
        activeCylinderIndex = cylinders.findIndex(c => c.group === o);
        if (activeCylinderIndex !== -1) { isDragging = true; dragStartX = e.clientX; dragStartRotation = cylinders[activeCylinderIndex].targetRotation; }
    }
}

function onPointerMove(e) { 
    const hint = document.getElementById('info-hint'); if(hint) { hint.style.left = e.clientX + 'px'; hint.style.top = e.clientY + 'px'; }
    const m = new THREE.Vector2((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
    const r = new THREE.Raycaster(); r.setFromCamera(m, camera);
    const intersects = r.intersectObjects(cylinders.map(c => c.mesh));
    
    if (intersects.length > 0) {
        isHovering = true; const catId = cylinders.findIndex(c => c.mesh === intersects[0].object);
        const uvIdx = Math.floor(intersects[0].uv.x * ITEM_COUNT);
        if (CATEGORIES[catId].items[uvIdx]) { if(hint) hint.style.display = 'block'; document.body.style.cursor = 'pointer'; }
        else { if(hint) hint.style.display = 'none'; document.body.style.cursor = 'grab'; }
    } else { 
        isHovering = false; if(hint) hint.style.display = 'none'; document.body.style.cursor = 'default'; 
    }
    
    if (isDragging) { cylinders[activeCylinderIndex].targetRotation = dragStartRotation + (Math.round((e.clientX - dragStartX) / 60) * ROTATION_STEP); document.body.style.cursor = 'grabbing'; }
}

function onPointerUp(e) {
    const dist = Math.hypot(e.clientX - pointerStartPos.x, e.clientY - pointerStartPos.y);
    if ((Date.now() - pointerStartTime) < 250 && dist < 5 && activeCylinderIndex !== -1) handleCylinderClick(e);
    isDragging = false; 
    if (activeCylinderIndex !== -1) { cylinders[activeCylinderIndex].targetRotation = Math.round(cylinders[activeCylinderIndex].targetRotation / ROTATION_STEP) * ROTATION_STEP; saveState(); }
}

function handleCylinderClick(e) {
    const m = new THREE.Vector2((e.clientX/innerWidth)*2-1, -(e.clientY/innerHeight)*2+1);
    const r = new THREE.Raycaster(); r.setFromCamera(m, camera);
    const intersects = r.intersectObjects(cylinders.map(c => c.mesh));
    if (intersects.length > 0) {
        const catId = cylinders.findIndex(c => c.mesh === intersects[0].object);
        const uvIdx = Math.floor(intersects[0].uv.x * ITEM_COUNT);
        if (CATEGORIES[catId].items[uvIdx]) showInfoPopup(catId, uvIdx);
    }
}

window.togglePanel = () => { const p = document.getElementById('management-panel'); p.style.display = p.style.display !== 'block' ? 'block' : 'none'; };
window.scrollCarousel = (dir) => { document.getElementById('style-carousel').scrollBy({ left: dir * 180, behavior: 'smooth' }); };
window.updateTopCarousel = () => { 
    const carousel = document.getElementById('style-carousel');
    const dotsContainer = document.getElementById('carousel-dots');
    const tripledSets = [...STYLE_SETS, ...STYLE_SETS, ...STYLE_SETS];
    carousel.innerHTML = tripledSets.map((s, idx) => `
        <div class="carousel-item ${ (editingSetId === s.id && Math.floor(idx / STYLE_SETS.length) === 1) ? 'active' : ''}" data-id="${s.id}" data-idx="${idx}" onclick="applyStyleSet(${s.id}, ${idx})">
            <div class="font-black">${s.name}</div>
        </div>`).join(''); 
    dotsContainer.innerHTML = STYLE_SETS.map((s, i) => `<div class="dot" onclick="scrollToSetIndex(${i})"></div>`).join('');
    if (carousel.scrollLeft === 0) carousel.scrollLeft = STYLE_SETS.length * 180;
    carousel.removeEventListener('scroll', handleInfiniteScroll);
    carousel.addEventListener('scroll', handleInfiniteScroll);
    updateActiveDot();
};

window.scrollToSetIndex = (idx) => {
    const carousel = document.getElementById('style-carousel');
    const items = carousel.querySelectorAll('.carousel-item');
    if (items[idx + STYLE_SETS.length]) items[idx + STYLE_SETS.length].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
};

function handleInfiniteScroll() {
    const carousel = document.getElementById('style-carousel');
    const itemWidth = 180; const scrollPos = carousel.scrollLeft; const totalContentWidth = STYLE_SETS.length * itemWidth;
    if (scrollPos < itemWidth) carousel.scrollLeft += totalContentWidth;
    else if (scrollPos > totalContentWidth * 2 - itemWidth) carousel.scrollLeft -= totalContentWidth;
    updateActiveDot();
}

function updateActiveDot() {
    const carousel = document.getElementById('style-carousel'); const dots = document.querySelectorAll('.dot'); if (!dots.length) return;
    const scrollPos = carousel.scrollLeft; const itemWidth = 180; const rawIdx = Math.round(scrollPos / itemWidth); const activeIdx = rawIdx % STYLE_SETS.length;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === activeIdx));
}

async function resizeImage(dataUrl, maxW = 720) {
    return new Promise((res) => {
        const img = new Image(); img.onload = () => {
            const canvas = document.createElement('canvas'); 
            const scale = Math.min(1, maxW / Math.max(img.width, img.height));
            canvas.width = img.width * scale; canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d'); 
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // 0.7 품질은 100장 저장을 위한 최적의 압축률입니다.
            res(canvas.toDataURL('image/jpeg', 0.7));
        }; img.src = dataUrl;
    });
}

window.handleFileUpload = async (e, id) => {
    const files = Array.from(e.target.files); if (!files.length) return;
    const catIdx = CATEGORIES.findIndex(c => c.id === id); if (catIdx === -1) return;

    // 카테고리별 20장 제한 체크
    if (CATEGORIES[catIdx].items.length >= ITEM_COUNT) {
        showMessage(`⚠️ ${CATEGORIES[catIdx].name} 카테고리는 이미 가득 찼습니다. (최대 ${ITEM_COUNT}장)`);
        e.target.value = ""; // 입력창 초기화
        return;
    }

    showMessage("100장 수용 모드: 초고밀도 압축 중...");
    try {
        const urls = await Promise.all(files.map(async f => {
            const rawUrl = await new Promise(res => { const rd = new FileReader(); rd.onload = ev => res(ev.target.result); rd.readAsDataURL(f); });
            return await resizeImage(rawUrl, 720);
        }));
        CATEGORIES[catIdx].items = [...urls.map(u => ({url:u, setIds:[]})), ...CATEGORIES[catIdx].items].slice(0, ITEM_COUNT);
        await updateCylinderTexture(catIdx); saveState(); createUI(); showMessage("최적화 업로드 완료! (100장 준비 완료) ✨");
    } catch (err) { console.error(err); showMessage("업로드 실패: 용량을 확인해 주세요."); }
};

window.deleteImage = async (catId, idx) => {
    const panel = document.getElementById('management-panel');
    const panelScroll = panel.scrollTop;
    
    // 현재 삭제하려는 카테고리의 갤러리 가로 스크롤 위치를 정확히 획득합니다.
    const grids = document.querySelectorAll('.thumbnail-grid');
    const gridIdx = CATEGORIES.findIndex(c => c.id === catId);
    const horizontalScroll = (gridIdx !== -1 && grids[gridIdx]) ? grids[gridIdx].scrollLeft : 0;

    CATEGORIES[catId].items.splice(idx, 1);
    await updateCylinderTexture(catId);
    saveState();
    createUI();
    
    // 삭제 후, 기억해둔 위치(세로+가로)로 즉시 복원합니다.
    panel.scrollTop = panelScroll;
    const newGrids = document.querySelectorAll('.thumbnail-grid');
    if (gridIdx !== -1 && newGrids[gridIdx]) {
        newGrids[gridIdx].scrollLeft = horizontalScroll;
    }
};

window.handleDragStart = (e, catId, idx) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ catId, idx }));
    e.target.classList.add('opacity-50');
};
window.handleDragOver = (e) => e.preventDefault();
window.handleDrop = async (e, targetCatId, targetIdx) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    const sourceCatId = data.catId; const sourceIdx = data.idx;
    if (sourceCatId !== targetCatId || sourceIdx === targetIdx) return;
    const panel = document.getElementById('management-panel'); const pScroll = panel.scrollTop;
    const grids = document.querySelectorAll('.thumbnail-grid'); const gIdx = CATEGORIES.findIndex(c => c.id === targetCatId);
    const hScroll = (gIdx !== -1 && grids[gIdx]) ? grids[gIdx].scrollLeft : 0;
    const items = CATEGORIES[targetCatId].items; const [moved] = items.splice(sourceIdx, 1); items.splice(targetIdx, 0, moved);
    await updateCylinderTexture(targetCatId); saveState(); createUI();
    panel.scrollTop = pScroll; const newG = document.querySelectorAll('.thumbnail-grid');
    if (gIdx !== -1 && newG[gIdx]) newG[gIdx].scrollLeft = hScroll;
};

window.uploadSetReferenceImage = async (setId, e) => {
    const file = e.target.files[0]; if (!file) return;
    showMessage("스타일 대표 이미지 압축 중...");
    try {
        const raw = await new Promise(res => { const rd = new FileReader(); rd.onload = ev => res(ev.target.result); rd.readAsDataURL(file); });
        const optimized = await resizeImage(raw, 720); // 100장 수용 모드와 동일한 압축
        const set = STYLE_SETS.find(s => s.id === setId);
        if (set) { set.repUrl = optimized; saveState(); createUI(); showMessage("스타일 화보 등록 완료! ✨"); }
    } catch (err) { console.error(err); showMessage("업로드 오류"); }
};

window.showSetReference = () => {
    if (!editingSetId) { showMessage("먼저 상단에서 스타일을 선택해 주세요."); return; }
    const set = STYLE_SETS.find(s => s.id === editingSetId);
    if (!set || !set.repUrl) { showMessage("이 스타일의 대표 이미지가 등록되지 않았습니다."); return; }
    
    document.getElementById('info-img').src = set.repUrl;
    document.getElementById('info-category').innerText = "STYLE CONCEPT";
    document.getElementById('info-title').innerText = set.name;
    document.getElementById('info-desc').innerText = "이 스타일 조합에 대한 오피셜 룩북 이미지입니다.";
    document.getElementById('info-popup').style.display = 'flex';
};

window.toggleTopBar = () => {}; // 기능 제거

window.handleSetDragStart = (e, idx) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'set', idx }));
    e.target.classList.add('opacity-40');
};
window.handleSetDragOver = (e) => e.preventDefault();
window.handleSetDrop = (e, targetIdx) => {
    e.preventDefault();
    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (data.type !== 'set' || data.idx === targetIdx) return;
    const [moved] = STYLE_SETS.splice(data.idx, 1);
    STYLE_SETS.splice(targetIdx, 0, moved);
    saveState(); createUI(); showMessage("세트 순서 변경 완료! ✨");
};

function createUI() {
    document.getElementById('category-controls').innerHTML = CATEGORIES.map(cat => `
        <div class="category-section">
            <div class="font-black text-[10px] text-slate-400 mb-3 uppercase">${cat.name}</div>
            <label class="block bg-slate-900 text-white text-[10px] p-2 text-center rounded-lg cursor-pointer mb-3">+ UPLOAD<input type="file" multiple class="hidden" onchange="handleFileUpload(event, ${cat.id})"></label>
            <div class="thumbnail-grid">${cat.items.map((item, i) => `
                <div class="thumb-container" draggable="true" ondragstart="handleDragStart(event, ${cat.id}, ${i})" ondragover="handleDragOver(event)" ondrop="handleDrop(event, ${cat.id}, ${i})">
                    <div class="thumb" onclick="showInfoPopup(${cat.id}, ${i})"><img src="${item.url}"></div>
                    <div class="delete-btn" onclick="deleteImage(${cat.id}, ${i})">×</div>
                    <div class="set-dropdown-container">
                        <div class="set-dropdown-trigger" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('active')">${(item.setIds || []).length} SETS <span>▼</span></div>
                        <div class="set-dropdown-menu">${STYLE_SETS.map(s => `<div class="dropdown-item ${item.setIds?.includes(s.id) ? 'selected' : ''}" onclick="event.stopPropagation(); toggleSetForItem(${cat.id}, ${i}, ${s.id})"><input type="checkbox" ${item.setIds?.includes(s.id) ? 'checked' : ''}>${s.name}</div>`).join('')}</div>
                    </div>
                    <textarea class="item-title" onchange="updateItemTitle(${cat.id}, ${i}, this.value)" placeholder="NAME">${item.title || ''}</textarea>
                    <textarea class="item-memo" onchange="updateItemMemo(${cat.id}, ${i}, this.value)" placeholder="DESC">${item.desc || ''}</textarea>
                    <input type="text" class="item-link-input" onchange="updateItemLink(${cat.id}, ${i}, this.value)" placeholder="URL LINK" value="${item.link || ''}">
                </div>`).join('')}</div>
        </div>`).join('');
    document.getElementById('set-settings-list').innerHTML = STYLE_SETS.map((s, i) => `
        <div class="set-item-row" draggable="true" ondragstart="handleSetDragStart(event, ${i})" ondragover="handleSetDragOver(event)" ondrop="handleSetDrop(event, ${i})">
            <div class="flex flex-col gap-1">
                <input type="text" value="${s.name}" onchange="renameStyleSet(${s.id}, this.value)" class="set-name-edit">
                <label class="text-[8px] text-blue-400 cursor-pointer hover:underline">
                    ${s.repUrl ? '● 이미지 등록됨' : '○ 이미지 업로드'}
                    <input type="file" class="hidden" onchange="uploadSetReferenceImage(${s.id}, event)">
                </label>
            </div>
            <div class="set-action-btns">
                <button onclick="saveCurrentToSet(${s.id})" class="set-mini-btn btn-save">SAVE</button>
                <button onclick="deleteStyleSet(${s.id})" class="set-mini-btn btn-delete">DEL</button>
            </div>
        </div>`).join('');
    updateTopCarousel();
}

window.alignToSet = (setId) => {
    if (!CATEGORIES || !cylinders || cylinders.length === 0) return;
    
    // 조작 시점 기록 및 5초간 자동 회전 일시 정지 설정
    lastInteractionTime = Date.now(); 
    pauseAutoDuration = 5000; 

    // 상단바 클릭하여 정렬이 되었을 때 변경될 5가지 프리미엄 배경 색상 테마 (CSS radial-gradient)
    const backgroundThemes = [
        "radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0f172a 60%, #020617 100%)", // 딥 오션 인디고
        "radial-gradient(circle at 50% 50%, #1a2e40 0%, #0f172a 60%, #030712 100%)", // 모던 틸 네이비
        "radial-gradient(circle at 50% 50%, #2e1065 0%, #0f172a 60%, #030712 100%)", // 딥 퍼플 나이트
        "radial-gradient(circle at 50% 50%, #1c1917 0%, #0c0a09 60%, #020202 100%)", // 클래식 차콜 흑색
        "radial-gradient(circle at 50% 50%, #064e3b 0%, #022c22 60%, #020617 100%)"  // 미드나잇 포레스트 그린
    ];
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        // 현재 배경과 다른 무작위 배경을 선택
        const currentBg = canvasContainer.style.background;
        let nextBg = currentBg;
        while (nextBg === currentBg) {
            nextBg = backgroundThemes[Math.floor(Math.random() * backgroundThemes.length)];
        }
        canvasContainer.style.background = nextBg;
    }

    for (let c = 0; c < cylinders.length; c++) {
        if (!CATEGORIES[c] || !CATEGORIES[c].items) continue;

        const idx = CATEGORIES[c].items.findIndex(item => item && (item.setIds && item.setIds.includes(setId)));
        if (idx !== -1) { 
            const cur = cylinders[c].group.rotation.y;
            const turns = Math.round(cur / (Math.PI * 2));
            const target = (turns * Math.PI * 2) - (idx * ROTATION_STEP); 
            cylinders[c].targetRotation = target;
        }
    }
    if(typeof saveState === "function") saveState(); 
    document.querySelectorAll('.carousel-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-id') == setId);
    });
};

window.applyStyleSet = (id, idx) => { editingSetId = id; window.alignToSet(id); if (idx !== undefined) { const cr = document.getElementById('style-carousel'); cr.scrollTo({ left: idx * 180, behavior: 'smooth' }); } };
window.addStyleSet = () => { const id = STYLE_SETS.length > 0 ? Math.max(...STYLE_SETS.map(s => s.id)) + 1 : 1; STYLE_SETS.push({ id, name: "NAME" }); saveState(); createUI(); };
window.toggleSetForItem = (catId, idx, setId) => { const item = CATEGORIES[catId].items[idx]; if (!item.setIds) item.setIds = []; if (item.setIds.includes(setId)) { item.setIds = item.setIds.filter(id => id !== setId); } else { CATEGORIES[catId].items.forEach((it, i) => { if (i !== idx && it.setIds) it.setIds = it.setIds.filter(id => id !== setId); }); item.setIds.push(setId); } saveState(); createUI(); };
window.renameStyleSet = (id, n) => { const s = STYLE_SETS.find(x => x.id === id); if(s) { s.name = n.toUpperCase(); saveState(); createUI(); } };
window.saveCurrentToSet = (id) => { cylinders.forEach((cyl, catIdx) => { const raw = Math.round(-cyl.targetRotation / ROTATION_STEP); const fIdx = ((raw % ITEM_COUNT) + ITEM_COUNT) % ITEM_COUNT; const it = CATEGORIES[catIdx].items[fIdx]; if(it) { if(!it.setIds) it.setIds = []; if(!it.setIds.includes(id)) it.setIds.push(id); } }); editingSetId = id; saveState(); createUI(); };
window.saveToShareableFile = async () => {
    showMessage("Fashion Rewinder 전시용 파일 생성 중...");
    try {
        const sessionData = { 
            categories: CATEGORIES, 
            sets: STYLE_SETS, 
            rotations: cylinders.map(c => c.targetRotation) 
        };
        // </body> 태그가 없을 경우를 대비한 안전한 치환
        let html = document.documentElement.outerHTML; 
        const escapedData = JSON.stringify(sessionData).replace(/</g, '\\u003c');
        const dataScript = `\n<script>window.EMBEDDED_DATA = ${escapedData};<\/script>\n`;
        
        // 기존 EMBEDDED_DATA 스크립트가 있다면 제거
        html = html.replace(/<script>window\.EMBEDDED_DATA = .*?<\/script>/s, ""); 
        
        // </body> 바로 앞에 주입
        if (html.includes("</body>")) {
            html = html.replace("</body>", dataScript + "</body>");
        } else {
            html += dataScript;
        }
        
        const blob = new Blob([html], { type: 'text/html' }); 
        const url = URL.createObjectURL(blob); 
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = `Fashion_Rewinder_Exhibition_FULL.html`; 
        a.click();
        showMessage("✅ 내보내기 완료!");
    } catch (err) { 
        console.error(err);
        showMessage("❌ 번들링 실패"); 
    }
};

window.deleteStyleSet = (id) => { if(STYLE_SETS.length <= 1) return; STYLE_SETS = STYLE_SETS.filter(x => x.id !== id); saveState(); createUI(); };

function saveState() { if (isLocked) return; try { localStorage.setItem('fm_imgs', JSON.stringify(CATEGORIES)); localStorage.setItem('fm_sets', JSON.stringify(STYLE_SETS)); localStorage.setItem('fm_rots', JSON.stringify(cylinders.map(c => c.targetRotation))); } catch (e) { if (e.name === 'QuotaExceededError') { showMessage("⚠️ 저장 공간이 부족합니다!"); } } }

window.showInfoPopup = (catId, idx) => { 
    const it = CATEGORIES[catId].items[idx]; 
    if (!it) return; 
    document.getElementById('info-img').src = it.url; 
    document.getElementById('info-category').innerText = CATEGORIES[catId].name; 
    document.getElementById('info-title').innerText = it.title || "ITEM"; 
    document.getElementById('info-desc').innerText = it.desc || "상세 정보 없음"; 
    
    const linkBtn = document.getElementById('info-link');
    const imgLink = document.getElementById('info-img-link');
    const buyOverlay = document.getElementById('info-buy-overlay');
    
    if (it.link) {
        linkBtn.href = it.link;
        linkBtn.style.display = 'inline-block';
        imgLink.href = it.link;
        imgLink.style.pointerEvents = 'auto';
        buyOverlay.style.display = 'flex';
    } else {
        linkBtn.style.display = 'none';
        imgLink.removeAttribute('href');
        imgLink.style.pointerEvents = 'none';
        buyOverlay.style.display = 'none';
    }
    
    document.getElementById('info-popup').style.display = 'flex'; 
};
window.closeInfoPopup = () => document.getElementById('info-popup').style.display = 'none';
window.randomize = () => { 
    lastInteractionTime = Date.now(); 
    pauseAutoDuration = 5000; 
    cylinders.forEach(c => {
        // 현재 위치에서 가장 가까운 인덱스를 기준으로 랜덤한 칸수만큼만 이동하여 정렬 보장
        const currentIdx = Math.round(-c.targetRotation / ROTATION_STEP);
        const randomShift = Math.floor(Math.random() * ITEM_COUNT) + ITEM_COUNT;
        c.targetRotation = -(currentIdx + randomShift) * ROTATION_STEP;
    }); 
    saveState(); 
};
window.resetRotation = () => { lastInteractionTime = Date.now(); pauseAutoDuration = 5000; cylinders.forEach(c => c.targetRotation = 0); saveState(); };
window.updateItemTitle = (cId, idx, val) => { CATEGORIES[cId].items[idx].title = val; saveState(); };
window.updateItemMemo = (cId, idx, val) => { CATEGORIES[cId].items[idx].desc = val; saveState(); };
window.updateItemLink = (cId, idx, val) => { CATEGORIES[cId].items[idx].link = val; saveState(); };
function updateStorageStatus() { const eb = window.EMBEDDED_DATA !== undefined; document.getElementById('storage-status').innerHTML = eb ? '<span class="text-green-500 font-black">● 데이터 내장됨</span>' : '<span>○ 브라우저 저장소</span>'; }
function showMessage(t) { const b = document.getElementById('message-box'); b.innerText = t; b.style.display = 'block'; setTimeout(() => b.style.display = 'none', 3000); }
function hideLoader() { document.getElementById('loading-screen').style.opacity = '0'; setTimeout(() => { document.getElementById('loading-screen').style.display = 'none'; }, 500); }
window.toggleTopBar = () => {
    const wrapper = document.getElementById('top-carousel-wrapper');
    wrapper.classList.toggle('hidden');
};

function getCurrentSelection() {
    let selectedItems = [];
    if (!cylinders || cylinders.length === 0 || !CATEGORIES) return [];

    for (let c = 0; c < cylinders.length; c++) {
        if (!CATEGORIES[c] || !CATEGORIES[c].items || CATEGORIES[c].items.length === 0) continue;

        let rot = cylinders[c].targetRotation;
        let turns = Math.round(rot / (Math.PI * 2));
        let normalizedRot = rot - (turns * Math.PI * 2);
        let idx = Math.round(-normalizedRot / ROTATION_STEP);
        
        idx = ((idx % ITEM_COUNT) + ITEM_COUNT) % ITEM_COUNT;
        
        let item = CATEGORIES[c].items[idx];
        if (item) {
            selectedItems.push(item);
        }
    }
    return selectedItems;
}

window.addEventListener('load', init); window.addEventListener('click', () => { document.querySelectorAll('.set-dropdown-menu').forEach(m => m.classList.remove('active')); });
window.closeInstructions = () => { const o = document.getElementById('instruction-overlay'); o.style.opacity = '0'; setTimeout(() => o.style.display = 'none', 500); };
window.showInstructions = () => { const o = document.getElementById('instruction-overlay'); o.style.display = 'flex'; setTimeout(() => o.style.opacity = '1', 10); };
window.addEventListener('keydown', (e) => { if (e.shiftKey && e.code === 'KeyL') { isLocked = !isLocked; document.body.classList.toggle('mode-locked', isLocked); showMessage(isLocked ? "🔒 전시 모드" : "🔓 편집 모드"); } });
// API 키 풀 (여러 개를 넣으면 자동으로 돌아가며 사용합니다)
const API_KEYS = [
    "",
    // "여기에_두번째_키를_넣으세요",
    // "여기에_세번째_키를_넣으세요"
];
let currentKeyIndex = 0;

function getNextKey() {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}


async function createCompositeImage(urls) {
    const canvas = document.createElement('canvas');
    // AI 인식률을 위한 최적 해상도
    canvas.width = 768; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const cellW = canvas.width / 3;
    const cellH = canvas.height / 2;

    for(let i=0; i<urls.length; i++) {
        if(!urls[i]) continue;
        await new Promise(res => {
            let img = new Image();
            if (!urls[i].startsWith('data:')) img.crossOrigin = "anonymous";
            img.onload = () => {
                let x = (i % 3) * cellW;
                let y = Math.floor(i / 3) * cellH;
                let scale = Math.min(cellW/img.width, cellH/img.height);
                let w = img.width * scale;
                let h = img.height * scale;
                ctx.drawImage(img, x + (cellW-w)/2, y + (cellH-h)/2, w, h);
                res();
            };
            img.onerror = res;
            img.src = urls[i];
        });
    }
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

window.generateAIStyle = async (e) => {
    const selectedItems = getCurrentSelection();
    if (selectedItems.length < 5) {
        showMessage("5개의 아이템 조합을 먼저 맞춰주세요!");
        return;
    }
    
    const u = selectedItems.map(item => item.url);
    
    const btn = (e && e.target) ? e.target : document.getElementById('ai-style-btn');
    if (btn && btn.disabled) return;

    const p = document.getElementById('ai-panel');
    const l = document.getElementById('ai-loading-indicator');
    const r = document.getElementById('ai-result-container');
    
    p.style.display = 'block'; 
    l.style.display = 'flex'; 
    r.style.display = 'none';
    
    if (btn) {
        btn.disabled = true;
        btn.innerText = "WAIT (30s)";
    }

    try {
        const b64 = await createCompositeImage(u);
        const activeKey = getNextKey();
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                contents:[{
                    parts:[
                        {text:"Create a detailed English prompt for ONE person wearing ALL FIVE items shown in the image. Style: Clean hand-drawn digital illustration, crisp black outlines, flat cel-shading, friendly modern lifestyle character, minimalist background. Mention the color and shape of each item clearly. Output format: [English prompt for image generation] \\n [Short Korean styling tip]"},
                        {inlineData:{mimeType:"image/jpeg", data:b64}}
                    ]
                }],
                generationConfig:{maxOutputTokens:150, temperature:0.7},
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        if (!res.ok) {
            const errorData = await res.json();
            console.error("Gemini API Error Detail:", errorData);
            const errMsg = errorData.error?.message || "";
            if (res.status === 429) {
                throw new Error("AI 사용량이 일시적으로 초과되었습니다. 잠시 후 다시 시도해 주세요. (HTTP 429)");
            }
            throw new Error(errMsg || `서버 응답 오류가 발생했습니다. (HTTP ${res.status})`);
        }

        const d = await res.json();
        
        if (d.usageMetadata) {
            console.log("📊 Token Usage:", d.usageMetadata);
        }

        if (d.candidates && d.candidates[0].content.parts[0].text) {
            const rawText = d.candidates[0].content.parts[0].text;
            const lines = rawText.split('\n').filter(l => l.trim() !== '');
            const englishPrompt = lines[0] || "fashion illustration, retro comic style";
            const koreanTip = lines.slice(1).join(' ') || "당신만의 멋진 스타일이 완성되었습니다!";

            // 나노바나나 스타일 시드 및 프롬프트 인코딩 (일치율 강화 키워드 추가)
            const seed = Math.floor(Math.random() * 1000000);
            const nanoBananaStyle = ", clean hand-drawn digital illustration, crisp black outlines, flat cel-shading, friendly modern lifestyle character, minimalist background, high quality graphic art, full body shot";
            const encodedPrompt = encodeURIComponent(englishPrompt + nanoBananaStyle);
            const generatedImgUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=768&nologo=true&seed=${seed}`;

            const resultImg = document.getElementById('ai-result-img');
            resultImg.onload = () => {
                l.style.display='none'; 
                r.style.display='flex';
                showMessage("✨ AI 화보 생성 완료!");
            };
            resultImg.onerror = () => {
                l.style.display='none';
                showMessage("⚠️ 이미지 생성 중 오류가 발생했습니다. 다시 시도해주세요.");
            };
            
            document.getElementById('ai-styling-tip').innerText = koreanTip;
            resultImg.src = generatedImgUrl;
        }
    } catch(err) {
        console.error("AI API Error (Switching to Backup Mode):", err.message);
        
        // 429 에러 또는 기타 오류 발생 시 백업 로직 가동
        const backupPrompt = selectedItems.map(item => item.title || "fashion item").join(", ");
        const backupTip = "나노바나나 스타일로 재해석된 당신만의 룩입니다. 유니크한 감성을 즐겨보세요!";
        
        const seed = Math.floor(Math.random() * 1000000);
        const nanoBananaStyle = ", clean hand-drawn digital illustration, crisp black outlines, flat cel-shading, friendly modern lifestyle character, minimalist background, high quality graphic art, full body shot";
        const encodedPrompt = encodeURIComponent(backupPrompt + nanoBananaStyle);
        const generatedImgUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=768&nologo=true&seed=${seed}`;

        const resultImg = document.getElementById('ai-result-img');
        resultImg.onload = () => {
            l.style.display='none'; 
            r.style.display='flex';
            showMessage("✨ 스타일 분석 완료! (Backup Mode)");
        };
        resultImg.onerror = () => {
            l.style.display='none';
            showMessage("⚠️ 이미지 생성 중 오류가 발생했습니다. 다시 시도해주세요.");
        };
        resultImg.src = generatedImgUrl;
        document.getElementById('ai-styling-tip').innerText = backupTip;

    } finally {
        if (btn) {
            setTimeout(() => {
                btn.disabled = false;
                btn.innerText = "AI STYLE";
            }, 30000);
        }
    }
};

window.closeAIPanel = () => { document.getElementById('ai-panel').style.display = 'none'; };
window.downloadAIResult = () => { const a = document.createElement('a'); a.href = document.getElementById('ai-result-img').src; a.download = `shot.jpg`; a.click(); };
