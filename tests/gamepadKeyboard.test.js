import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMEPAD_KEYBOARD_ROWS,
  appendKeyboardCharacter,
  removeLastKeyboardCharacter,
} from '../src/game/gamepadKeyboard.js';

test('gamepad keyboard provides letters, numbers and Polish characters', () => {
  const keys = GAMEPAD_KEYBOARD_ROWS.flat();
  for (const character of ['0', 'A', 'Z', 'Ą', 'Ł', 'Ż', '-', '.']) {
    assert.equal(keys.includes(character), true, `missing ${character}`);
  }
});

test('gamepad keyboard edits text without splitting Unicode characters', () => {
  assert.equal(removeLastKeyboardCharacter('Łódź'), 'Łód');
  assert.equal(removeLastKeyboardCharacter('A😀'), 'A');
  assert.equal(removeLastKeyboardCharacter(''), '');
  assert.equal(appendKeyboardCharacter('PAR', 'I', 4), 'PARI');
  assert.equal(appendKeyboardCharacter('PARI', 'S', 4), 'PARI');
});
