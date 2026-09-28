/**
 * phrases.test.mjs —— 话术库单测（T17 组）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PHRASES,
  CUSTOM_CAT,
  PH_CUSTOM_KEY,
  loadCustomPhrases,
  saveCustomPhrases,
  allCats,
  itemsOf,
  searchPhrases,
} from '../src/phrases.js'

test('T17a 内置话术 7 类 60 条与融合工具一致', () => {
  assert.equal(PHRASES.length, 7)
  assert.equal(
    PHRASES.reduce((n, g) => n + g.items.length, 0),
    60,
  )
  assert.deepEqual(
    PHRASES.map((g) => g.cat),
    ['轮廓', '眼部', '鼻部', '唇部口周', '高光影调', '骨相点位', '常用短句'],
  )
  // 抽查关键条目（迁移保真）
  assert.ok(PHRASES[0].items.includes('外轮廓不流畅'))
  assert.ok(PHRASES[1].items.includes('泪沟明显'))
  assert.ok(PHRASES[6].items.includes('术后改善明显'))
})

test('T17b 自定义话术存取（注入 mock storage）', () => {
  const store = new Map()
  const io = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  }
  assert.deepEqual(loadCustomPhrases(io), [])
  saveCustomPhrases(['建议水光针', ''], io)
  assert.equal(store.get(PH_CUSTOM_KEY), JSON.stringify(['建议水光针', '']))
  assert.deepEqual(loadCustomPhrases(io), ['建议水光针', ''])
  // 坏数据不炸
  store.set(PH_CUSTOM_KEY, '{oops')
  assert.deepEqual(loadCustomPhrases(io), [])
  store.set(PH_CUSTOM_KEY, '"str"')
  assert.deepEqual(loadCustomPhrases(io), [], '非数组返回空')
})

test('T17c 无 storage 环境安全降级', () => {
  assert.deepEqual(loadCustomPhrases(null), [])
  saveCustomPhrases(['x'], null) // 不应抛错
})

test('T17d allCats 仅在自定义非空时附加', () => {
  const base = allCats([])
  assert.equal(base.length, 7)
  assert.ok(!base.includes(CUSTOM_CAT))
  assert.equal(allCats(['x']).length, 8)
  assert.ok(allCats(['x']).includes(CUSTOM_CAT))
})

test('T17e itemsOf 分类取值', () => {
  assert.equal(itemsOf('轮廓', []).length, 10)
  assert.equal(itemsOf('唇部口周', []).length, 5)
  assert.deepEqual(itemsOf(CUSTOM_CAT, ['a', 'b']), ['a', 'b'])
  assert.deepEqual(itemsOf('不存在', []), [])
})

test('T17f 搜索：分类名整类命中 + 条目模糊匹配', () => {
  // 关键词命中分类名 → 该分类整类返回（条目匹配的组也会并列出现）
  const byCat = searchPhrases('鼻部', [])
  const noseGroup = byCat.find((g) => g.cat === '鼻部')
  assert.ok(noseGroup, '分类名命中应返回整类')
  assert.equal(noseGroup.items.length, 9)
  assert.ok(
    byCat.some((g) => g.cat === '高光影调' && g.items.includes('鼻部高光')),
    '条目含关键词的其他分类也应出现',
  )
  // 条目匹配
  const byItem = searchPhrases('泪沟', [])
  assert.equal(byItem.length, 1)
  assert.deepEqual(byItem[0].items, ['泪沟明显'])
  // 空 → 全量
  assert.equal(searchPhrases('', []).length, 7)
  assert.equal(searchPhrases(null, []).length, 7)
  // 自定义参与搜索
  const withCustom = searchPhrases('水光', ['水光针导入'])
  assert.equal(withCustom.length, 1)
  assert.equal(withCustom[0].cat, CUSTOM_CAT)
  // 无命中
  assert.equal(searchPhrases('不存在的词xyz', []).length, 0)
})
