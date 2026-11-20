import { describe, expect, it } from 'vitest';
import { isolationParams } from './tenant-isolation';

describe('isolationParams', () => {
  it('junta as organizações visíveis e a principal', () => {
    expect(isolationParams(['a-1', 'b-2'], 'a-1')).toEqual(['a-1,b-2', 'a-1']);
  });

  it('descarta id com caractere estranho (tentativa de injeção)', () => {
    expect(isolationParams(['a-1', "x',evil"], "b'; drop")).toEqual(['a-1', '']);
  });
});
