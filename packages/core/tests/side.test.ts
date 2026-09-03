import { describe, expect, it } from 'vitest';
import { money } from '../src/money';
import { sideFromAmount, signedAmountFor } from '../src/side';

const eur = (minor: number) => money(minor, 'EUR');

describe('sideFromAmount', () => {
  it('reads the sign when a source gives nothing else', () => {
    expect(sideFromAmount(eur(-4210))).toBe('expense');
    expect(sideFromAmount(eur(4210))).toBe('income');
  });
});

describe('signedAmountFor', () => {
  it('makes an expense negative', () => {
    expect(signedAmountFor('expense', eur(4210), false)).toEqual(eur(-4210));
  });

  it('makes income positive', () => {
    expect(signedAmountFor('income', eur(4210), false)).toEqual(eur(4210));
  });

  it('keeps a refund positive on the expense side, where it reduces spending', () => {
    expect(signedAmountFor('expense', eur(2000), true)).toEqual(eur(2000));
    expect(sideFromAmount(signedAmountFor('expense', eur(2000), true))).toBe('income');
  });

  it('makes a clawback negative on the income side', () => {
    expect(signedAmountFor('income', eur(2000), true)).toEqual(eur(-2000));
  });

  it('reads the typed value as a magnitude, so a stray minus cannot double-flip it', () => {
    expect(signedAmountFor('expense', eur(-4210), false)).toEqual(eur(-4210));
    expect(signedAmountFor('income', eur(-4210), false)).toEqual(eur(4210));
  });

  it('leaves zero alone rather than inventing a negative zero', () => {
    expect(signedAmountFor('expense', eur(0), false)).toEqual(eur(0));
  });

  it('keeps the currency it was given', () => {
    expect(signedAmountFor('expense', money(500, 'USD'), false)).toEqual(money(-500, 'USD'));
  });
});
