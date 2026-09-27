import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

/** Owns the renderer, camera, lights and resize handling. Modes add and remove their own objects. */
export class SceneHost {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly canvas: HTMLCanvasElement;
  private readonly onResize = () => this.resize();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0;
    this.canvas.style.display = 'block';
    this.canvas.style.outline = 'none';
    container.appendChild(this.canvas);

    this.camera = new PerspectiveCamera(75, 1, 0.1, 2000);
    this.camera.rotation.order = 'YXZ';

    this.scene.background = new Color(0x87b7e6);
    this.scene.fog = new Fog(0x87b7e6, 200, 700);

    this.hemi = new HemisphereLight(0xcfe8ff, 0x6b7a4c, 0.9);
    this.scene.add(this.hemi);
    this.sun = new DirectionalLight(0xfff2d6, 1.6);
    this.sun.position.set(60, 120, 40);
    this.scene.add(this.sun);

    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** PNG data URL of the current frame. */
  screenshot(): string {
    this.render();
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
