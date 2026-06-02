import { TARGET_SAMPLE_RATE } from './constants'

type BrowserAudioContext = typeof AudioContext

export function getAudioContextConstructor(): BrowserAudioContext | null {
  return window.AudioContext ?? null
}

function floatTo16BitPcm(samples: Float32Array) {
  const output = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff
  }
  return output
}

function resampleTo16Khz(samples: Float32Array, sourceSampleRate: number) {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return samples

  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = sourceIndex - left
    output[i] = samples[left] * (1 - weight) + samples[right] * weight
  }

  return output
}

export function encodeWav(samples: Float32Array, sourceSampleRate: number) {
  const resampled = resampleTo16Khz(samples, sourceSampleRate)
  const pcm = floatTo16BitPcm(resampled)
  const buffer = new ArrayBuffer(44 + pcm.byteLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, TARGET_SAMPLE_RATE, true)
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, pcm.byteLength, true)

  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(44 + i * 2, pcm[i], true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}
