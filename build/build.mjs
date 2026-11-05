// Retrostrap build: bundles css/index.css (plain CSS @imports) into dist/retrostrap-<version>.css
// and a minified .min.css. Zero dependencies - only Node's standard library (Node >= 18).
//
//   node build/build.mjs            build once
//   node build/build.mjs --watch    rebuild when anything in css/ changes

import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'css/index.css')
const outDir = resolve(root, 'dist')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const outName = `retrostrap-${version}`

const IMPORT = /@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?\s*;?/g

// Inline @import rules depth-first, each file once, keeping source order.
function bundle(file, seen = new Set()) {
  if (seen.has(file)) return ''
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  return src.replace(IMPORT, (_, __, target) => {
    if (/^(https?:)?\/\//.test(target)) throw new Error(`Remote @import not supported: ${target}`)
    return bundle(resolve(dirname(file), target), seen)
  })
}

// Conservative minifier: strips comments (keeps /*! banners) and redundant whitespace.
// It never touches strings or url(), and keeps spaces around ':' and operators (calc, selectors).
function minify(css) {
  let out = ''
  let i = 0
  const n = css.length
  while (i < n) {
    const c = css[i]
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && css[j] !== c) j += css[j] === '\\' ? 2 : 1
      out += css.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (css[i + 2] === '!') out += css.slice(i, end + 2) + '\n'
      i = end + 2
    } else if (/\s/.test(c)) {
      while (i < n && /\s/.test(css[i])) i++
      const prev = out[out.length - 1]
      const next = css[i]
      // whitespace next to these tokens is never significant
      if (!out || /[{};,\n]/.test(prev) || next === undefined || /[{};,]/.test(next)) continue
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out.replace(/;}/g, '}')
}

function build() {
  const started = performance.now()
  const css = bundle(entry).replace(/\n{3,}/g, '\n\n').trim() + '\n'
  const min = minify(css)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, `${outName}.css`), css)
  writeFileSync(resolve(outDir, `${outName}.min.css`), min)
  const kb = (b) => (b / 1024).toFixed(1) + ' kB'
  const base = relative(root, resolve(outDir, outName))
  console.log(`Retrostrap ${version} built in ${Math.round(performance.now() - started)}ms`)
  console.log(`  ${base}.css      ${kb(Buffer.byteLength(css))}`)
  console.log(`  ${base}.min.css  ${kb(Buffer.byteLength(min))} (${kb(gzipSync(min).length)} gzipped)`)
}

build()

if (process.argv.includes('--watch')) {
  console.log('Watching css/ ...')
  let timer
  watch(resolve(root, 'css'), { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try { build() } catch (e) { console.error(e.message) }
    }, 50)
  })
}
