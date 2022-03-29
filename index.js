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

const bg = document.getElementById('background')

bg.style['opacity'] = "0" // in case css is not yet loaded
window.onload = () => {
    window.addEventListener("scroll", () => {
        bg.style['opacity'] = window.scrollY > 0 ? "0" : "1"
    })

    bg.style['transition'] = "opacity 1s"
    bg.style['opacity'] = "1"

    init()
    initParticles()
    animate()

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

const count = 64

const clock = new THREE.Clock()
const dummy = new THREE.Object3D()
const particles = []

let camera, scene, renderer, instancedMesh, inputEvent

function init() {
    const width = window.innerWidth
    const height = window.innerHeight

    camera = new THREE.OrthographicCamera(width / -2, width / 2, height / 2, height / -2, 1, 1000)
    camera.position.z = 1

    scene = new THREE.Scene()
    scene.add(camera)

    const map = new THREE.TextureLoader().load('images/star.png')
    const material = new THREE.MeshStandardMaterial({
        emissive: new THREE.Color(1, 1, 1),
        map: map,
        emissiveMap: map,
        transparent: true,
        blending: THREE.NormalBlending,
        opacity: 1.0
    })
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)

    instancedMesh = new THREE.InstancedMesh(geometry, material, count)
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

    scene.add(instancedMesh)

    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true})
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight)

    const container = document.getElementById('particles')
    container.appendChild(renderer.domElement)

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
    render()
}

function render() {
    const delta = Math.min(clock.getDelta(), 1 / 30.0)
    const vw = window.innerWidth
    const vh = window.innerHeight
    const aspect = vh / vw
    const t = clock.getElapsedTime()

    const tx = inputEvent ? inputEvent.clientX / vw : 0.5 + Math.sin(t * 0.881)
    const ty = inputEvent ? 1.0 - inputEvent.clientY / vh : 0.5 + Math.cos(t * 0.487) * 0.75

    for (let i = 0; i < count; ++i) {
        const particle = particles[i]

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

        const panic = inputEvent ? Math.min((l * l) * 32.0, 1.0) : Math.min(l * l - 0.2, 1.0)
        const turnrate = inputEvent ? 3.0 : 0.75
        const turn = particle.turnrate * turnrate * panic * delta
        const dot = r90x * nx + r90y * ny

        if (dot > 0) {
            particle.rotation += turn
        } else {
            particle.rotation -= turn
        }

        const speed = 0.15 + (1 + Math.cos(t * 0.4)) * 0.1
        const scale = particle.scale

        particle.x += vx * speed * delta * scale * aspect
        particle.y += vy * speed * delta * scale

        const size = 64
        dummy.position.set(particle.x * vw - vw * 0.5, particle.y * vh - vh * 0.5, 0)
        dummy.scale.set(size * scale, size * scale, 1)
        dummy.updateMatrix()
        instancedMesh.setMatrixAt(i, dummy.matrix)
    }
    instancedMesh.instanceMatrix.needsUpdate = true

    renderer.render(scene, camera)
}
