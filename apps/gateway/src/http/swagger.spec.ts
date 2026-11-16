import { isSwaggerEnabled } from './swagger';

describe('isSwaggerEnabled', () => {
  it.each([undefined, '', 'true', '1', 'yes'])('%p -> bật', (value) => {
    expect(isSwaggerEnabled(value)).toBe(true);
  });

  it.each(['false', 'FALSE', ' false '])('%p -> tắt', (value) => {
    expect(isSwaggerEnabled(value)).toBe(false);
  });
});
