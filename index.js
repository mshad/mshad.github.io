/* -----------------------------------------
  Have focus outline only for keyboard users
 ---------------------------------------- */

const handleFirstTab = (e) => {
    if (e.key === 'Tab') {
        document.body.classList.add('user-is-tabbing')

        window.removeEventListener('keydown', handleFirstTab)
        window.addEventListener('mousedown', handleMouseDownOnce)
    }

}

const handleMouseDownOnce = () => {
    document.body.classList.remove('user-is-tabbing')

    window.removeEventListener('mousedown', handleMouseDownOnce)
    window.addEventListener('keydown', handleFirstTab)
}

window.addEventListener('keydown', handleFirstTab)

const backToTopButton = document.querySelector(".back-to-top");
let isBackToTopRendered = false;

let alterStyles = (isBackToTopRendered) => {
    backToTopButton.style.visibility = isBackToTopRendered ? "visible" : "hidden";
    backToTopButton.style.opacity = isBackToTopRendered ? 1 : 0;
    backToTopButton.style.transform = isBackToTopRendered
        ? "scale(1)"
        : "scale(0)";
};

window.addEventListener("scroll", () => {
    if (window.scrollY > 700) {
        isBackToTopRendered = true;
        alterStyles(isBackToTopRendered);
    } else {
        isBackToTopRendered = false;
        alterStyles(isBackToTopRendered);
    }
});

const count = 64;

const clock = new THREE.Clock();
const dummy = new THREE.Object3D();
const particles = []

let camera, scene, renderer, instancedMesh;

init();
animate();

function init() {
    for (let i = 0; i < count; ++i) {
        const particle = {
            x: -0.5 + Math.random(),
            y: -0.5 + Math.random() * 0.5,
            speed: 0.1,
            rotation: Math.PI * 0.5,
            r: Math.random() * Math.PI,
            r2: Math.random() * Math.PI,
            r3: Math.random() * 0.05,
            r4: Math.random() * 0.05,
            scale: 1 + Math.random()
        }
        particles.push(particle)
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 1, 1000);
    camera.position.z = 1;

    scene = new THREE.Scene();
    scene.add(camera);

    const map = new THREE.TextureLoader().load('images/star.png');
    const material = new THREE.MeshStandardMaterial({
        emissive: new THREE.Color(1, 1, 1),
        map: map,
        emissiveMap: map,
        transparent: true,
        blending: THREE.NormalBlending,
        opacity: 1.0
    });
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

    instancedMesh = new THREE.InstancedMesh(geometry, material, count)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    scene.add(instancedMesh);

    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const container = document.getElementById('particles-js');
    container.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.left = width / -2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = height / -2;

    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    render();
}

function render() {
    const delta = Math.min(clock.getDelta(), 1 / 30.0);
    const vw = window.innerWidth
    const vh = window.innerHeight
    const aspect = vh / vw
    const t = clock.getElapsedTime()
    const tx = 0.5 + Math.sin(t * 0.881)
    const ty = 0.5 + Math.cos(t * 0.487) * 0.75
    for (let i = 0; i < count; ++i) {
        const particle = particles[i]

        const dx = particle.x - (tx + Math.sin(particle.r + t * particle.r3 * t) * 0.3 * aspect)
        const dy = particle.y - (ty + Math.sin(particle.r2 + t * particle.r4 * t) * 0.3)
        const l = Math.sqrt(dx * dx + dy * dy)
        const inv = 1 / l
        const nx = dx * inv
        const ny = dy * inv

        const vx = Math.cos(particle.rotation)
        const vy = Math.sin(particle.rotation)

        const r90x = vy
        const r90y = vx * -1

        const d = (r90x * nx + r90y * ny)

        const panic = Math.min(l - 0.2, 1.0)

        if (d > 0) {
            particle.rotation += 1.5 * panic * delta;
        } else {
            particle.rotation -= 1.5 * panic * delta;
        }

        const s = particle.scale

        const speed = 0.15 + (1 + Math.cos(t * 0.4)) * 0.1

        particle.x += vx * speed * delta * s * aspect
        particle.y += vy * speed * delta * s

        dummy.position.set(particle.x * vw - vw * 0.5, particle.y * vh - vh * 0.5, 0)
        dummy.scale.set(64 * s, 64 * s, 1)
        dummy.updateMatrix()
        instancedMesh.setMatrixAt(i, dummy.matrix)
    }
    instancedMesh.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
}
