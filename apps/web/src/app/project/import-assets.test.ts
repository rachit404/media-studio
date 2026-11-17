import { describe, expect, it } from 'vitest';
import { displayName } from './import-assets';

describe('displayName', () => {
  it('keeps only the file name part and removes control characters', () => {
    expect(displayName('C:\\Users\\me\\photo.png')).toBe('photo.png');
    expect(displayName('/home/me/pic.jpg')).toBe('pic.jpg');
    expect(displayName('bad\u0000name\u001f.gif')).toBe('badname.gif');
  });

  it('falls back and truncates', () => {
    expect(displayName('')).toBe('Image');
    expect(displayName('   ')).toBe('Image');
    expect(displayName('x'.repeat(400))).toHaveLength(255);
  });
});
