import { useEffect, useRef, useState } from 'react'
import heroImg from './assets/hero.png'
import fullscreenVertSrc from './shaders/fullscreen.vert.glsl?raw'
import blurFragSrc from './shaders/blur.frag.glsl?raw'
import liquidGlassFragSrc from './shaders/liquidGlass.frag.glsl?raw'
import {
  createFullscreenQuad,
  createProgram,
  createTextureFromCanvas,
  createTextureTarget,
} from './lib/webgl'
import './App.css'

const initialSettings = {
  mouseControl: false,
  powerFactor: 3.0,
  width: 3.5,
  height: 3.5,
  blurIters: 1,
  blurRadius: 2.0,
  blurDownscale: 0.5,
  noise: 0.06,
  fPower: 1.0,
  a: 0.7,
  b: 2.3,
  c: 5.2,
  d: 6.9,
  glowWeight: 0.25,
  glowBias: 0.0,
  glowEdge0: 0.5,
  glowEdge1: -0.5,
  vsync: true,
}

const initialBackgrounds = [
  { id: 'white', name: 'White', credits: 'Solid white background' },
  { id: 'hero', name: 'Hero', credits: 'Photo credit: "Cubes" by Lernert & Sander' },
]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function computeCoverRect(srcWidth, srcHeight, dstWidth, dstHeight) {
  const scale = Math.max(dstWidth / srcWidth, dstHeight / srcHeight)
  const width = srcWidth * scale
  const height = srcHeight * scale
  return {
    x: (dstWidth - width) * 0.5,
    y: (dstHeight - height) * 0.5,
    width,
    height,
  }
}

function App() {
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const settingsRef = useRef(initialSettings)
  const backgroundIdRef = useRef('white')
  const backgroundsRef = useRef(new Map())
  const runtimeRef = useRef({ reloadShader: null })
  const [settings, setSettings] = useState(initialSettings)
  const [backgroundId, setBackgroundId] = useState('white')
  const [backgrounds, setBackgrounds] = useState(initialBackgrounds)
  const [fps, setFps] = useState(0)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    backgroundIdRef.current = backgroundId
  }, [backgroundId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: false,
    })

    if (!gl) return undefined

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)

    const quad = createFullscreenQuad(gl)
    let blurProgram = null
    let glassProgram = null
    let blurLocations = null
    let glassLocations = null

    const compilePrograms = () => {
      blurProgram = createProgram(gl, fullscreenVertSrc, blurFragSrc)
      glassProgram = createProgram(gl, fullscreenVertSrc, liquidGlassFragSrc)

      blurLocations = {
        input: gl.getUniformLocation(blurProgram, 'u_input'),
        direction: gl.getUniformLocation(blurProgram, 'u_direction'),
        resolution: gl.getUniformLocation(blurProgram, 'u_resolution'),
        radius: gl.getUniformLocation(blurProgram, 'u_radius'),
      }

      glassLocations = {
        background: gl.getUniformLocation(glassProgram, 'u_background'),
        blur: gl.getUniformLocation(glassProgram, 'u_blur'),
        resolution: gl.getUniformLocation(glassProgram, 'u_resolution'),
        center: gl.getUniformLocation(glassProgram, 'u_center'),
        width: gl.getUniformLocation(glassProgram, 'u_width'),
        height: gl.getUniformLocation(glassProgram, 'u_height'),
        powerFactor: gl.getUniformLocation(glassProgram, 'u_powerFactor'),
        a: gl.getUniformLocation(glassProgram, 'u_a'),
        b: gl.getUniformLocation(glassProgram, 'u_b'),
        c: gl.getUniformLocation(glassProgram, 'u_c'),
        d: gl.getUniformLocation(glassProgram, 'u_d'),
        fPower: gl.getUniformLocation(glassProgram, 'u_fPower'),
        noise: gl.getUniformLocation(glassProgram, 'u_noise'),
        glowWeight: gl.getUniformLocation(glassProgram, 'u_glowWeight'),
        glowBias: gl.getUniformLocation(glassProgram, 'u_glowBias'),
        glowEdge0: gl.getUniformLocation(glassProgram, 'u_glowEdge0'),
        glowEdge1: gl.getUniformLocation(glassProgram, 'u_glowEdge1'),
        time: gl.getUniformLocation(glassProgram, 'u_time'),
      }
    }

    compilePrograms()

    const backgroundTexture = gl.createTexture()
    let blurTargetA = createTextureTarget(gl, 1, 1)
    let blurTargetB = createTextureTarget(gl, 1, 1)
    const backgroundCanvas = document.createElement('canvas')
    const backgroundCtx = backgroundCanvas.getContext('2d')

    if (!backgroundTexture || !backgroundCtx) return undefined

    const sceneState = {
      backgroundDirty: true,
      blurDirty: true,
      backgroundWidth: 1,
      backgroundHeight: 1,
      blurWidth: 1,
      blurHeight: 1,
      blurTexture: backgroundTexture,
    }

    const heroImage = new Image()
    heroImage.crossOrigin = 'anonymous'
    heroImage.decoding = 'async'
    heroImage.src = heroImg
    backgroundsRef.current.set('hero', {
      id: 'hero',
      name: 'Hero',
      credits: 'Photo credit: "Cubes" by Lernert & Sander',
      image: heroImage,
    })

    let disposed = false
    let raf = 0
    let lastTimestamp = 0
    let fpsSmoothed = 0
    let lastFpsPaint = 0
    let pointer = { x: 0.5, y: 0.5 }
    let lastBgId = null
    let lastBlurScale = -1
    let lastBlurIters = -1
    let lastBlurRadius = -1

    const allocateBlurTargets = (width, height) => {
      blurTargetA = createTextureTarget(gl, width, height)
      blurTargetB = createTextureTarget(gl, width, height)
      sceneState.blurWidth = width
      sceneState.blurHeight = height
    }

    const resizeBlurTargets = (width, height) => {
      if (sceneState.blurWidth === width && sceneState.blurHeight === height) return
      gl.deleteTexture(blurTargetA.texture)
      gl.deleteTexture(blurTargetB.texture)
      gl.deleteFramebuffer(blurTargetA.framebuffer)
      gl.deleteFramebuffer(blurTargetB.framebuffer)
      allocateBlurTargets(width, height)
    }

    const drawBackground = () => {
      const width = Math.max(1, canvas.width)
      const height = Math.max(1, canvas.height)
      const selected = backgroundsRef.current.get(backgroundIdRef.current)

      backgroundCanvas.width = width
      backgroundCanvas.height = height
      backgroundCtx.fillStyle = '#ffffff'
      backgroundCtx.fillRect(0, 0, width, height)

      if (selected?.image && selected.image.complete && selected.image.naturalWidth > 0) {
        const rect = computeCoverRect(
          selected.image.naturalWidth,
          selected.image.naturalHeight,
          width,
          height,
        )
        backgroundCtx.drawImage(selected.image, rect.x, rect.y, rect.width, rect.height)
      }

      createTextureFromCanvas(gl, backgroundTexture, backgroundCanvas)
      sceneState.backgroundWidth = width
      sceneState.backgroundHeight = height
      sceneState.backgroundDirty = false
      sceneState.blurDirty = true
      sceneState.blurTexture = backgroundTexture

      const blurWidth = Math.max(1, Math.floor(width * settingsRef.current.blurDownscale))
      const blurHeight = Math.max(1, Math.floor(height * settingsRef.current.blurDownscale))
      resizeBlurTargets(blurWidth, blurHeight)
    }

    const drawBlurPass = (inputTexture, target, direction) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.viewport(0, 0, target.width, target.height)
      gl.useProgram(blurProgram)
      gl.bindVertexArray(quad.vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, inputTexture)
      gl.uniform1i(blurLocations.input, 0)
      gl.uniform2f(blurLocations.direction, direction[0], direction[1])
      gl.uniform2f(blurLocations.resolution, target.width, target.height)
      gl.uniform1f(blurLocations.radius, settingsRef.current.blurRadius)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const rebuildBlur = () => {
      const blurIters = Math.round(settingsRef.current.blurIters)

      if (blurIters <= 0) {
        sceneState.blurTexture = backgroundTexture
        sceneState.blurDirty = false
        return
      }

      let sourceTexture = backgroundTexture
      for (let i = 0; i < blurIters; i += 1) {
        drawBlurPass(sourceTexture, blurTargetA, [1, 0])
        drawBlurPass(blurTargetA.texture, blurTargetB, [0, 1])
        sourceTexture = blurTargetB.texture
      }

      sceneState.blurTexture = sourceTexture
      sceneState.blurDirty = false
    }

    const reloadShader = () => {
      gl.deleteProgram(blurProgram)
      gl.deleteProgram(glassProgram)
      compilePrograms()
      sceneState.backgroundDirty = true
      sceneState.blurDirty = true
    }

    runtimeRef.current.reloadShader = reloadShader

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))

      if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width
        canvas.height = height
        sceneState.backgroundDirty = true
        sceneState.blurDirty = true
      }

      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const uploadGlassUniforms = (time) => {
      const blurTexture = sceneState.blurTexture || backgroundTexture
      gl.useProgram(glassProgram)
      gl.bindVertexArray(quad.vao)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, backgroundTexture)
      gl.uniform1i(glassLocations.background, 0)

      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, blurTexture)
      gl.uniform1i(glassLocations.blur, 1)

      gl.uniform2f(glassLocations.resolution, canvas.width, canvas.height)
      gl.uniform2f(glassLocations.center, pointer.x, pointer.y)
      gl.uniform1f(glassLocations.width, settingsRef.current.width)
      gl.uniform1f(glassLocations.height, settingsRef.current.height)
      gl.uniform1f(glassLocations.powerFactor, settingsRef.current.powerFactor)
      gl.uniform1f(glassLocations.a, settingsRef.current.a)
      gl.uniform1f(glassLocations.b, settingsRef.current.b)
      gl.uniform1f(glassLocations.c, settingsRef.current.c)
      gl.uniform1f(glassLocations.d, settingsRef.current.d)
      gl.uniform1f(glassLocations.fPower, settingsRef.current.fPower)
      gl.uniform1f(glassLocations.noise, settingsRef.current.noise)
      gl.uniform1f(glassLocations.glowWeight, settingsRef.current.glowWeight)
      gl.uniform1f(glassLocations.glowBias, settingsRef.current.glowBias)
      gl.uniform1f(glassLocations.glowEdge0, settingsRef.current.glowEdge0)
      gl.uniform1f(glassLocations.glowEdge1, settingsRef.current.glowEdge1)
      gl.uniform1f(glassLocations.time, time * 0.001)
    }

    const frame = (time) => {
      if (disposed) return

      resizeCanvas()

      if (lastBgId !== backgroundIdRef.current) {
        sceneState.backgroundDirty = true
        sceneState.blurDirty = true
        lastBgId = backgroundIdRef.current
      }

      const desiredBlurWidth = Math.max(1, Math.floor(canvas.width * settingsRef.current.blurDownscale))
      const desiredBlurHeight = Math.max(1, Math.floor(canvas.height * settingsRef.current.blurDownscale))
      if (
        desiredBlurWidth !== sceneState.blurWidth ||
        desiredBlurHeight !== sceneState.blurHeight ||
        lastBlurScale !== settingsRef.current.blurDownscale
      ) {
        lastBlurScale = settingsRef.current.blurDownscale
        sceneState.blurDirty = true
        resizeBlurTargets(desiredBlurWidth, desiredBlurHeight)
      }

      if (lastBlurIters !== settingsRef.current.blurIters) {
        lastBlurIters = settingsRef.current.blurIters
        sceneState.blurDirty = true
      }
      if (lastBlurRadius !== settingsRef.current.blurRadius) {
        lastBlurRadius = settingsRef.current.blurRadius
        sceneState.blurDirty = true
      }

      if (sceneState.backgroundDirty) {
        drawBackground()
      }

      if (sceneState.blurDirty) {
        rebuildBlur()
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(1, 1, 1, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      uploadGlassUniforms(time)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      const delta = lastTimestamp ? time - lastTimestamp : 0
      lastTimestamp = time
      if (delta > 0) {
        const fpsNow = 1000 / delta
        fpsSmoothed = fpsSmoothed ? fpsSmoothed * 0.9 + fpsNow * 0.1 : fpsNow
      }
      if (time - lastFpsPaint > 250) {
        lastFpsPaint = time
        setFps(Math.round(fpsSmoothed || 0))
      }

      raf = window.requestAnimationFrame(frame)
    }

    const onPointerDown = (event) => {
      if (!settingsRef.current.mouseControl) return
      const rect = canvas.getBoundingClientRect()
      pointer = {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
      }
      canvas.setPointerCapture(event.pointerId)
    }

    const onPointerMove = (event) => {
      if (!settingsRef.current.mouseControl) return
      const rect = canvas.getBoundingClientRect()
      pointer = {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
      }
    }

    const onPointerUp = (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    }

    const onResize = () => {
      sceneState.backgroundDirty = true
      sceneState.blurDirty = true
      resizeCanvas()
    }

    heroImage.onload = () => {
      if (backgroundIdRef.current === 'hero') {
        sceneState.backgroundDirty = true
      }
    }

    window.addEventListener('resize', onResize)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerUp)

    resizeCanvas()
    sceneState.backgroundDirty = true
    sceneState.blurDirty = true
    frame(0)

    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerUp)
      gl.deleteProgram(blurProgram)
      gl.deleteProgram(glassProgram)
      gl.deleteTexture(backgroundTexture)
      gl.deleteTexture(blurTargetA.texture)
      gl.deleteTexture(blurTargetB.texture)
      gl.deleteFramebuffer(blurTargetA.framebuffer)
      gl.deleteFramebuffer(blurTargetB.framebuffer)
      gl.deleteVertexArray(quad.vao)
      gl.deleteBuffer(quad.buffer)
    }
  }, [])

  const updateSetting = (key) => (event) => {
    const value =
      event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value)
    setSettings((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const handleBackgroundChange = (event) => {
    setBackgroundId(event.target.value)
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handlePhotoUpload = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const id = `photo-${Date.now()}`
      const name = file.name.replace(/\.[^.]+$/, '') || 'Uploaded photo'
      const credits = `Uploaded photo: ${file.name}`
      backgroundsRef.current.set(id, { id, name, credits, image })
      setBackgrounds((current) => [...current, { id, name, credits }])
      setBackgroundId(id)
      URL.revokeObjectURL(objectUrl)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
    }
    image.src = objectUrl
  }

  const currentBackground = backgrounds.find((item) => item.id === backgroundId) || backgrounds[0]

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="shader-canvas" aria-label="Liquid glass shader" />

      <aside className="debug-panel">
        <div className="debug-inner">
          <h2>Settings</h2>

          <label className="field field-select">
            <span>Background</span>
            <div className="background-row">
              <select value={backgroundId} onChange={handleBackgroundChange}>
                {backgrounds.map((bg) => (
                  <option key={bg.id} value={bg.id}>
                    {bg.name}
                  </option>
                ))}
              </select>
              <button type="button" className="upload-button" onClick={handleUploadClick}>
                Add photo
              </button>
            </div>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoUpload}
            hidden
          />

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.mouseControl}
              onChange={updateSetting('mouseControl')}
            />
            <span>Move with mouse</span>
          </label>

          <details open className="section">
            <summary>Shape</summary>
            <div className="section-body">
              <label className="slider-field">
                <span>Power</span>
                <input
                  type="range"
                  min="1.001"
                  max="6"
                  step="0.001"
                  value={settings.powerFactor}
                  onChange={updateSetting('powerFactor')}
                />
              </label>
              <label className="slider-field">
                <span>Width</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.01"
                  value={settings.width}
                  onChange={updateSetting('width')}
                />
              </label>
              <label className="slider-field">
                <span>Height</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.01"
                  value={settings.height}
                  onChange={updateSetting('height')}
                />
              </label>
            </div>
          </details>

          <details open className="section">
            <summary>Blur &amp; Noise</summary>
            <div className="section-body">
              <label className="slider-field">
                <span>Blur Iters</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={settings.blurIters}
                  onChange={updateSetting('blurIters')}
                />
              </label>
              <label className="slider-field">
                <span>Blur Radius</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.01"
                  value={settings.blurRadius}
                  onChange={updateSetting('blurRadius')}
                />
              </label>
              <label className="slider-field">
                <span>Blur downscale</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.01"
                  value={settings.blurDownscale}
                  onChange={updateSetting('blurDownscale')}
                />
              </label>
              <label className="slider-field">
                <span>Noise</span>
                <input
                  type="range"
                  min="0"
                  max="0.3"
                  step="0.001"
                  value={settings.noise}
                  onChange={updateSetting('noise')}
                />
              </label>
            </div>
          </details>

          <details open className="section">
            <summary>Refraction</summary>
            <div className="section-body">
              <p className="equation">f(x) = 1 - b (ce)^(-dx-a)</p>
              <label className="slider-field">
                <span>f(x) Power</span>
                <input
                  type="range"
                  min="-1.5"
                  max="6"
                  step="0.01"
                  value={settings.fPower}
                  onChange={updateSetting('fPower')}
                />
              </label>
              <label className="slider-field">
                <span>a</span>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.01"
                  value={settings.a}
                  onChange={updateSetting('a')}
                />
              </label>
              <label className="slider-field">
                <span>b</span>
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="0.01"
                  value={settings.b}
                  onChange={updateSetting('b')}
                />
              </label>
              <label className="slider-field">
                <span>c</span>
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="0.01"
                  value={settings.c}
                  onChange={updateSetting('c')}
                />
              </label>
              <label className="slider-field">
                <span>d</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.01"
                  value={settings.d}
                  onChange={updateSetting('d')}
                />
              </label>
            </div>
          </details>

          <details open className="section">
            <summary>Glow</summary>
            <div className="section-body">
              <label className="slider-field">
                <span>Glow weight</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={settings.glowWeight}
                  onChange={updateSetting('glowWeight')}
                />
              </label>
              <label className="slider-field">
                <span>Glow bias</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={settings.glowBias}
                  onChange={updateSetting('glowBias')}
                />
              </label>
              <label className="slider-field">
                <span>Glow edge0</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={settings.glowEdge0}
                  onChange={updateSetting('glowEdge0')}
                />
              </label>
              <label className="slider-field">
                <span>Glow edge1</span>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={settings.glowEdge1}
                  onChange={updateSetting('glowEdge1')}
                />
              </label>
            </div>
          </details>

          <div className="footer-row">
            <span>{fps} FPS</span>
            <button
              type="button"
              className="text-button"
              onClick={() => runtimeRef.current.reloadShader?.()}
            >
              Reload shader
            </button>
            <label className="toggle-row compact">
              <input type="checkbox" checked={settings.vsync} onChange={updateSetting('vsync')} />
              <span>VSync</span>
            </label>
          </div>

          <p className="credits">{currentBackground?.credits}</p>
        </div>
      </aside>
    </main>
  )
}

export default App
