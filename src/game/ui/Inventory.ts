import * as THREE from 'three';

export type InventoryItem = {
  id: string;
  name: string;
  icon: string; // fallback emoji
  object3D?: THREE.Object3D; // the actual 3D object from the level — used for thumbnail
};

type SlotClickCallback = (itemId: string | null) => void;

// Shared offscreen renderer for generating item thumbnails
let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbScene = new THREE.Scene();
const thumbCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 10);
const THUMB_SIZE = 96;

function ensureThumbRenderer() {
  if (thumbRenderer) return thumbRenderer;
  thumbRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
  thumbRenderer.setClearColor(0x000000, 0);
  thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;

  // Lighting for thumbnails
  const ambient = new THREE.AmbientLight(0xffffff, 2.0);
  thumbScene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 3.0);
  dir.position.set(1, 2, 2);
  thumbScene.add(dir);
  const rim = new THREE.DirectionalLight(0x8888ff, 1.0);
  rim.position.set(-1, 0, -1);
  thumbScene.add(rim);

  return thumbRenderer;
}

function renderThumbnail(source: THREE.Object3D): string {
  const renderer = ensureThumbRenderer();

  // Clone to avoid mutating the original
  const clone = source.clone(true);

  // Force all parts visible (source may have been hidden after pickup)
  clone.visible = true;
  clone.traverse((c) => {
    c.visible = true;
    // Remove lights from clone — they mess up bounding box and aren't needed
    if ((c as any).isLight) c.visible = false;
  });

  // Reset transforms — we want the object centered
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.scale.set(1, 1, 1);
  clone.updateMatrixWorld(true);

  // Compute bounding box from meshes only
  const box = new THREE.Box3();
  clone.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      const meshBox = new THREE.Box3().setFromObject(c);
      box.union(meshBox);
    }
  });
  if (box.isEmpty()) return '';

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // Center the object
  clone.position.sub(center);

  // Slight tilt for 3D feel
  const pivot = new THREE.Group();
  pivot.rotation.set(0.3, -0.6, 0);
  pivot.add(clone);
  thumbScene.add(pivot);

  // Position camera to frame the object
  const dist = maxDim * 1.8;
  thumbCamera.position.set(0, 0, dist);
  thumbCamera.lookAt(0, 0, 0);
  thumbCamera.updateProjectionMatrix();

  renderer.render(thumbScene, thumbCamera);

  const dataUrl = renderer.domElement.toDataURL('image/png');

  // Cleanup
  thumbScene.remove(pivot);

  return dataUrl;
}

export class Inventory {
  private readonly el: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private items: InventoryItem[] = [];
  private thumbnails = new Map<string, string>(); // item id → data URL
  private activeSlot = -1;
  private onSelectCb: SlotClickCallback | null = null;
  private readonly maxSlots = 5;

  constructor(rootEl: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'inventory-bar';

    for (let i = 0; i < this.maxSlots; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      slot.dataset.index = String(i);
      slot.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onSlotClick(i);
      });
      this.slots.push(slot);
      this.el.appendChild(slot);
    }

    this.el.style.display = 'none';
    rootEl.appendChild(this.el);
  }

  public onSelect(cb: SlotClickCallback) {
    this.onSelectCb = cb;
  }

  public show() {
    this.el.style.display = 'flex';
  }

  public hide() {
    this.el.style.display = 'none';
  }

  /** Pre-render a 3D thumbnail before the object is picked up (avoids stutter) */
  public preRenderThumbnail(id: string, object3D: THREE.Object3D) {
    if (this.thumbnails.has(id)) return;
    try {
      const url = renderThumbnail(object3D);
      if (url) this.thumbnails.set(id, url);
    } catch (e) {
      console.warn('Pre-render thumbnail failed:', e);
    }
  }

  public addItem(item: InventoryItem) {
    if (this.items.length >= this.maxSlots) return;
    if (this.items.find(i => i.id === item.id)) return;

    this.items.push(item);
    this.render();
    if (this.items.length === 1) {
      this.selectSlot(0);
    }

    // Defer thumbnail rendering to avoid frame stutter
    if (item.object3D && !this.thumbnails.has(item.id)) {
      const obj = item.object3D;
      const id = item.id;
      requestAnimationFrame(() => {
        try {
          const url = renderThumbnail(obj);
          if (url) {
            this.thumbnails.set(id, url);
            this.render();
          }
        } catch (e) {
          console.warn('Inventory thumbnail render failed:', e);
        }
      });
    }
  }

  public removeItem(id: string) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return;
    this.items.splice(idx, 1);
    this.thumbnails.delete(id);
    if (this.activeSlot === idx) {
      this.activeSlot = -1;
      this.onSelectCb?.(null);
    } else if (this.activeSlot > idx) {
      this.activeSlot--;
    }
    this.render();
  }

  public hasItem(id: string): boolean {
    return this.items.some(i => i.id === id);
  }

  public getActiveItemId(): string | null {
    if (this.activeSlot < 0 || this.activeSlot >= this.items.length) return null;
    return this.items[this.activeSlot].id;
  }

  public clear() {
    this.items = [];
    this.thumbnails.clear();
    this.activeSlot = -1;
    this.render();
  }

  public selectItem(id: string) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx !== -1) this.selectSlot(idx);
  }

  public clickSlot(index: number) {
    this.onSlotClick(index);
  }

  private onSlotClick(index: number) {
    if (index >= this.items.length) return;
    if (this.activeSlot === index) {
      this.activeSlot = -1;
      this.onSelectCb?.(null);
    } else {
      this.selectSlot(index);
    }
    this.render();
  }

  private selectSlot(index: number) {
    this.activeSlot = index;
    this.render();
    if (index >= 0 && index < this.items.length) {
      this.onSelectCb?.(this.items[index].id);
    }
  }

  private render() {
    for (let i = 0; i < this.maxSlots; i++) {
      const slot = this.slots[i];
      if (i < this.items.length) {
        const item = this.items[i];
        const thumb = this.thumbnails.get(item.id);
        if (thumb) {
          slot.textContent = '';
          slot.style.backgroundImage = `url(${thumb})`;
          slot.style.backgroundSize = 'contain';
          slot.style.backgroundPosition = 'center';
          slot.style.backgroundRepeat = 'no-repeat';
        } else {
          slot.textContent = item.icon;
          slot.style.backgroundImage = '';
        }
        slot.title = item.name;
        slot.classList.add('has-item');
        slot.classList.toggle('active', i === this.activeSlot);
      } else {
        slot.textContent = '';
        slot.style.backgroundImage = '';
        slot.title = '';
        slot.classList.remove('has-item', 'active');
      }
    }
  }
}
