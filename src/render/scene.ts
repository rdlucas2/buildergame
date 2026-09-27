import { Color, DirectionalLight, Fog, HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const DAY_SKY = new Color(0x87b7e6);
const DUSK_SKY = new Color(0xe9a26f);
const NIGHT_SKY = new Color(0x0d1628);
const DAY_HEMI = new Color(0xcfe8ff);
const NIGHT_HEMI = new Color(0x4a5a86);
const DAY_GROUND = new Color(0x6b7a4c);
const NIGHT_GROUND = new Color(0x1c2230);
const SUN_COLOR = new Color(0xfff2d6);
const DUSK_SUN = new Color(0xffb070);
const MOON_COLOR = new Color(0x9fb4ff);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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

  /**
   * Lights the scene for a time of day in [0, 1) (0 midnight, 0.5 noon): the sun moves across the
   * sky, the sky and fog shift through dusk to night, and a dim bluish moon keeps nights playable.
   */
  applyDaylight(timeOfDay: number): void {
    const angle = (timeOfDay - 0.25) * Math.PI * 2;
    const elev = Math.sin(angle);
    const day = smoothstep(-0.12, 0.2, elev);
    const dusk = 1 - Math.min(1, Math.abs(elev) / 0.25);
    const sky = (this.scene.background as Color).copy(NIGHT_SKY).lerp(DAY_SKY, day);
    sky.lerp(DUSK_SKY, dusk * 0.55 * smoothstep(-0.25, 0.05, elev));
    (this.scene.fog as Fog).color.copy(sky);

    if (elev > -0.05) {
      this.sun.position.set(-Math.cos(angle) * 150, Math.max(8, elev * 150), 50);
      this.sun.color.copy(SUN_COLOR).lerp(DUSK_SUN, dusk * 0.7);
      this.sun.intensity = 1.6 * smoothstep(-0.05, 0.3, elev) + 0.05;
    } else {
      this.sun.position.set(Math.cos(angle) * 150, Math.max(8, -elev * 150), -50);
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = 0.35;
    }
    this.hemi.color.copy(NIGHT_HEMI).lerp(DAY_HEMI, day);
    this.hemi.groundColor.copy(NIGHT_GROUND).lerp(DAY_GROUND, day);
    this.hemi.intensity = 0.55 + 0.35 * day;
  }

  /** Restores the fixed midday lighting used by plain worlds and the structure editor. */
  resetDaylight(): void {
    (this.scene.background as Color).copy(DAY_SKY);
    (this.scene.fog as Fog).color.copy(DAY_SKY);
    this.sun.position.set(60, 120, 40);
    this.sun.color.copy(SUN_COLOR);
    this.sun.intensity = 1.6;
    this.hemi.color.copy(DAY_HEMI);
    this.hemi.groundColor.copy(DAY_GROUND);
    this.hemi.intensity = 0.9;
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
