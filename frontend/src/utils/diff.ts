export function lineDiff(before: string, after: string): Array<{ type: 'same' | 'add' | 'del'; text: string }> {
  const a = (before || '').split('\n');
  const b = (after || '').split('\n');
  const max = Math.max(a.length, b.length);
  const rows: Array<{ type: 'same' | 'add' | 'del'; text: string }> = [];
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) {
      if (right !== undefined) rows.push({ type: 'same', text: right });
    } else {
      if (left !== undefined) rows.push({ type: 'del', text: left });
      if (right !== undefined) rows.push({ type: 'add', text: right });
    }
  }
  return rows;
}
