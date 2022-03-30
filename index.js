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

const backToTopButton = document.querySelector(".back-to-top")
let isBackToTopRendered = false

let alterStyles = (isBackToTopRendered) => {
    backToTopButton.style.visibility = isBackToTopRendered ? "visible" : "hidden"
    backToTopButton.style.opacity = isBackToTopRendered ? 1 : 0
    backToTopButton.style.transform = isBackToTopRendered
        ? "scale(1)"
        : "scale(0)"
};

window.addEventListener("scroll", () => {
    if (window.scrollY > 700) {
        isBackToTopRendered = true
        alterStyles(isBackToTopRendered)
    } else {
        isBackToTopRendered = false
        alterStyles(isBackToTopRendered)
    }
})

function vertexShader() {
    return `
    varying vec3 vUv; 

    void main() {
        vUv = position + 0.5;
        vUv.y = 1.0 - uv.y; 
        vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
    }
  `
}

function fragmentShader() {
    return `
    varying vec3 vUv;
    uniform float uTime;

    void main() {
        vec2 uv = vUv.xy, uv2 = uv;
        uv2.xy -= vec2(.5);
        float s = sin(uTime), c = cos(uTime);
        uv2 *= mat2(c, -s, s, c);
        uv2.xy += vec2(.5);
       
        vec4 b = vec4(0.01, 0.05, 0.14, 1.);
        vec4 p = vec4(0.13, 0.08, 0.13, 1.);
        vec4 lb = vec4(0.10, 0.21, 0.33, 1.);
        vec4 blb = mix(b, lb, -uv2.x * .2 - (uv2.y * .5));
        vec4 col = mix(blb, p, uv2.x - (uv2.y * 1.5));
        
        float l = uv.x;
        l*=l;
        l*=l;
        l*=l;
        float r = 1.0 - uv.x;
        r*=r;
        r*=r;
        r*=r;
        float g = (l + r) * 0.1;
        col += vec4(1.0) * g;
        
        gl_FragColor = col;
    }
  `
}

const count = 64
const clock = new THREE.Clock()
const dummy = new THREE.Object3D()
const particles = []

let camera, scene, renderer, instancedMesh, auroraMesh, map, inputEvent

function init() {
    map = new THREE.TextureLoader().load('images/star.png', animate)
}

function initScene() {
    const width = window.innerWidth
    const height = window.innerHeight

    camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 1, 1000)
    camera.position.z = 1

    scene = new THREE.Scene()
    scene.add(camera)

    const material = new THREE.MeshStandardMaterial({
        emissive: new THREE.Color(1, 1, 1),
        map: map,
        emissiveMap: map,
        transparent: true,
        blending: THREE.NormalBlending,
        opacity: 1.0
    })

    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)

    const auroraMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: {value: 0}
        },
        fragmentShader: fragmentShader(),
        vertexShader: vertexShader(),
    })

    auroraMesh = new THREE.Mesh(geometry, auroraMaterial)
    scene.add(auroraMesh)

    instancedMesh = new THREE.InstancedMesh(geometry, material, count)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    scene.add(instancedMesh)

    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true})
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight)

    const container = document.getElementById('particles')
    container.appendChild(renderer.domElement)
}

function initInput() {
    let timeoutId
    const handleInputEvent = (timeout) => {
        timeoutId && clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            inputEvent = null
        }, timeout)
    }

    window.addEventListener('mousemove', e => {
        inputEvent = {clientX: e.clientX, clientY: e.clientY}
        handleInputEvent(500)
    })

    window.addEventListener('touchmove', e => {
        inputEvent = {clientX: e.touches[0].clientX, clientY: e.touches[0].clientY}
        handleInputEvent(2500)
    })

    window.addEventListener('resize', onWindowResize)
}

function initParticles() {
    for (let i = 0; i < count; ++i) {
        const particle = {
            x: -0.5 + Math.random(),
            y: -0.5 + Math.random() * 0.5,
            speed: 0.1,
            rotation: Math.PI * 0.5,
            r: (Math.random() - 0.5) * 0.3,
            r2: (Math.random() - 0.5) * 0.3,
            turnrate: 1 + Math.random(),
            scale: 1 + Math.random()
        }
        particles.push(particle)
    }
}

function onWindowResize() {
    const width = window.innerWidth
    const height = window.innerHeight

    camera.left = width / -2
    camera.right = width / 2
    camera.top = height / 2
    camera.bottom = height / -2

    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}

function animate() {
    requestAnimationFrame(animate)
    update()
    render()
}

function update() {
    const delta = Math.min(clock.getDelta(), 1 / 30.0)
    const time = clock.getElapsedTime()
    updateParticles(time, delta)
    updateAurora(time)
}

function updateAurora(time) {
    auroraMesh.scale.set(window.innerWidth, window.innerHeight, 1)
    auroraMesh.material.uniforms.uTime.value = time
}

function updateParticles(time, delta) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const aspect = vh / vw

    const tx = inputEvent ? inputEvent.clientX / vw : 0.5 + Math.sin(time * 0.881)
    const ty = inputEvent ? 1.0 - inputEvent.clientY / vh : 0.5 + Math.cos(time * 0.487) * 0.75
    const speed = 0.15 + (1 + Math.cos(time * 0.4)) * 0.1
    const size = 64

    for (let i = 0; i < count; ++i) {
        const particle = particles[i]
        const scale = particle.scale
        const of = inputEvent ? 0.3 : 1
        const ox = tx + particle.r * aspect * of
        const oy = ty + particle.r2 * of
        const dx = particle.x - ox
        const dy = particle.y - oy
        const l = Math.sqrt(dx * dx + dy * dy)
        const inv = 1 / l
        const nx = dx * inv
        const ny = dy * inv
        const vx = Math.cos(particle.rotation)
        const vy = Math.sin(particle.rotation)
        const r90x = vy
        const r90y = vx * -1
        const panic = inputEvent ? Math.min(l * l * 32.0, 1.0) * 3.0 : Math.min(l * l - 0.2, 1.0) * 0.75
        const turn = particle.turnrate * panic * delta
        const dot = r90x * nx + r90y * ny

        particle.rotation += dot > 0 ? turn : -turn
        particle.x += vx * speed * delta * scale * aspect
        particle.y += vy * speed * delta * scale

        dummy.position.set(particle.x * vw - vw * 0.5, particle.y * vh - vh * 0.5, 0)
        dummy.scale.set(size * scale, size * scale, 1)
        dummy.updateMatrix()
        instancedMesh.setMatrixAt(i, dummy.matrix)
    }
    instancedMesh.instanceMatrix.needsUpdate = true
}

function render() {
    renderer.render(scene, camera)
}

window.onload = function () {
    anime.timeline({loop: false})
        .add({
            targets: '.word',
            scale: [2, 1],
            opacity: [0, 1],
            translateY: ["50px", 0],
            easing: 'easeOutCubic',
            duration: 600,
            delay: (el, i) => 1500 + 300 * i
        })
}

function run() {
    init()
    initScene()
    initInput()
    initParticles()
}

run()