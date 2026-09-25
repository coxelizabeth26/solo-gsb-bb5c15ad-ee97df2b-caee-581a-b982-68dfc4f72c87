'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createState,
  validateEdge,
  findDescendants,
  MAX_DESCENDANT_GENERATIONS,
} = require('../server/familyGraph');

/** 测试辅助：批量建成员（成员 id 与姓名相同） */
function makeState(names) {
  const state = createState();
  for (const name of names) {
    const member = { id: name, name };
    state.members.push(member);
    state.parentsOf[member.id] = [];
  }
  return state;
}

function add(state, parent, child) {
  const r = validateEdge(state, parent, child);
  assert.equal(r.error, null, `应允许 ${parent} -> ${child}：${r.error || ''}`);
  state.parentsOf[child].push(parent);
}

/** 取某成员的结果项 */
function memberOf(result, id) {
  const m = result.members.find((x) => x.id === id);
  assert.ok(m, `结果中应包含成员「${id}」`);
  return m;
}

/** 取某后代的所属分支（ID 数组） */
function branchesOf(result, id) {
  const m = result.memberBranches.find((x) => x.id === id);
  return m ? m.branchIds : null;
}

test('后代支系：线性家谱按最短代数分组', () => {
  const state = makeState(['A', 'B', 'C', 'D']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  add(state, 'C', 'D');

  const r = findDescendants(state, 'A', 10);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.members.map((m) => [m.id, m.generation]), [
    ['A', 0],
    ['B', 1],
    ['C', 2],
    ['D', 3],
  ]);
  assert.deepEqual(r.branches, ['B']);
  assert.deepEqual(branchesOf(r, 'B'), ['B']);
  assert.deepEqual(branchesOf(r, 'C'), ['B']);
  assert.deepEqual(branchesOf(r, 'D'), ['B']);
  // 始祖本人没有所属分支
  assert.equal(r.memberBranches.find((m) => m.id === 'A'), undefined);
  assert.equal(r.edges.length, 3);
  assert.equal(r.truncated, false);
});

test('后代支系：始祖本人 0 代恒包含；无后代时只返回始祖', () => {
  const state = makeState(['A', 'X']);
  add(state, 'X', 'A'); // A 是 X 的子女：以 A 为始祖时没有后代
  const r = findDescendants(state, 'A', 5);
  assert.deepEqual(r.members.map((m) => m.id), ['A']);
  assert.deepEqual(r.branches, []);
  assert.deepEqual(r.memberBranches, []);
  assert.deepEqual(r.edges, []);
  assert.equal(r.truncated, false);
});

test('后代支系：同一后代经多条路径到达只显示一次，且可属于多个分支', () => {
  // 始祖 A 有两个直系子女 B1、B2；B1→C，B2→C（钻石）：
  // C 距 A 最短 2 代，同时属于 B1、B2 两个分支
  const state = makeState(['A', 'B1', 'B2', 'C']);
  add(state, 'A', 'B1');
  add(state, 'A', 'B2');
  add(state, 'B1', 'C');
  add(state, 'B2', 'C');

  const r = findDescendants(state, 'A', 10);
  assert.equal(r.members.filter((m) => m.id === 'C').length, 1);
  assert.equal(memberOf(r, 'C').generation, 2);
  assert.deepEqual(r.branches, ['B1', 'B2']);
  assert.deepEqual(branchesOf(r, 'C'), ['B1', 'B2']);
  // 四条关系都在支系内
  assert.equal(r.edges.length, 4);
});

test('后代支系：分组按最短代数（存在更长路径时不影响代数）', () => {
  // A→B、A→D（1 代分支）；B→C；C→X、D→X：X 最短 2 代（经 D），最长 3 代（经 C）
  const state = makeState(['A', 'B', 'C', 'D', 'X']);
  add(state, 'A', 'B');
  add(state, 'A', 'D');
  add(state, 'B', 'C');
  add(state, 'C', 'X');
  add(state, 'D', 'X');

  const r = findDescendants(state, 'A', 10);
  assert.equal(memberOf(r, 'X').generation, 2);
  // X 可经两个直系子女分支到达
  assert.deepEqual(branchesOf(r, 'X'), ['B', 'D']);
  assert.equal(memberOf(r, 'C').generation, 2);
});

test('后代支系：代限截断——maxGenerations=1 只含直系子女', () => {
  const state = makeState(['A', 'B', 'C']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');

  const r = findDescendants(state, 'A', 1);
  assert.deepEqual(r.members.map((m) => m.id), ['A', 'B']);
  assert.equal(r.edges.length, 1); // A→B 在支系内；B→C 因 C 在支系外被排除
  assert.equal(r.truncated, true);
  assert.equal(r.boundaryCount, 1);
});

test('后代支系：代限边界上的跨深度路径——短路径命中的分支仍标记', () => {
  // A 的直系子女 B 与 D；B→C→X（3 代），D→X（2 代）。
  // 上限 2 代时：X 经 D 的 2 代路径在预算内，属于 D 分支；
  // 经 B 的 3 代路径超预算，不属于 B 分支；C 为 2 代成员。
  const state = makeState(['A', 'B', 'C', 'D', 'X']);
  add(state, 'A', 'B');
  add(state, 'A', 'D');
  add(state, 'B', 'C');
  add(state, 'C', 'X');
  add(state, 'D', 'X');

  const r = findDescendants(state, 'A', 2);
  assert.deepEqual(r.members.map((m) => [m.id, m.generation]).sort(), [
    ['A', 0],
    ['B', 1],
    ['C', 2],
    ['D', 1],
    ['X', 2],
  ]);
  assert.deepEqual(branchesOf(r, 'X'), ['D']);
  assert.deepEqual(branchesOf(r, 'C'), ['B']);
  // C→X、D→X 两端都在支系内；C→X 虽在 B 分支预算外，但仍是支系内关系
  const edgeKeys = r.edges.map((e) => `${e.parentId}>${e.childId}`).sort();
  assert.deepEqual(edgeKeys, ['A>B', 'A>D', 'B>C', 'C>X', 'D>X']);
  // 没有通向代限之外的边（X 是边界成员但其没有子女）
  assert.equal(r.truncated, false);
});

test('后代支系：只保留两端都在支系内的关系，不带入支系外成员', () => {
  // A→B→C；C 的配偶方向另有外部子女 W（C→W），且 B 有一位支系外父母 O（O→B）。
  // 支系视图中 O→B（O 在支系外但 B 在内）与 C→W（W 在外）都不应出现为支系内关系。
  const state = makeState(['A', 'B', 'C', 'O', 'W']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  add(state, 'O', 'B'); // O 是 B 的另一位父母，在 A 的支系之外
  add(state, 'C', 'W'); // W 是 C 的子女，但超出 2 代上限

  const r = findDescendants(state, 'A', 2);
  const edgeKeys = r.edges.map((e) => `${e.parentId}>${e.childId}`).sort();
  assert.deepEqual(edgeKeys, ['A>B', 'B>C']);
  assert.ok(!r.members.some((m) => m.id === 'O'));
  assert.ok(!r.members.some((m) => m.id === 'W'));
  assert.equal(r.truncated, true);
  assert.equal(r.boundaryCount, 1); // 仅 C→W 是边界成员通向代限外子女
});

test('后代支系：提升代限后边界成员重新展开，truncated 消失', () => {
  const state = makeState(['A', 'B', 'C']);
  add(state, 'A', 'B');
  add(state, 'B', 'C');
  const r2 = findDescendants(state, 'A', 2);
  assert.deepEqual(r2.members.map((m) => m.id), ['A', 'B', 'C']);
  assert.equal(r2.truncated, false);
  assert.equal(r2.edges.length, 2);
});

test('后代支系：方向相反的祖先不被当作后代', () => {
  const state = makeState(['A', 'P']);
  add(state, 'P', 'A'); // P 是 A 的父母
  const r = findDescendants(state, 'A', 10);
  assert.deepEqual(r.members.map((m) => m.id), ['A']);
  assert.equal(r.edges.length, 0);
});

test('后代支系：互不相连的成员不会进入支系', () => {
  const state = makeState(['A', 'B', 'X', 'Y']);
  add(state, 'A', 'B');
  add(state, 'X', 'Y');
  const r = findDescendants(state, 'A', 10);
  assert.deepEqual(r.members.map((m) => m.id), ['A', 'B']);
  assert.equal(r.edges.length, 1);
});

test('后代支系：参数校验', () => {
  const state = makeState(['A']);
  assert.match(findDescendants(state, 'A', 0).error, /1 到 10/);
  assert.match(findDescendants(state, 'A', 11).error, /1 到 10/);
  assert.match(findDescendants(state, 'A', 1.5).error, /整数/);
  assert.match(findDescendants(state, 'A', '3').error, /整数/);
  assert.equal(MAX_DESCENDANT_GENERATIONS, 10);
  assert.match(findDescendants(state, 'ghost', 3).error, /成员不存在/);
});
