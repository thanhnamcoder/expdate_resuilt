import { getFieldErrorMap } from './formValidation';

describe('getFieldErrorMap', () => {
  it('flags missing required fields for a normal entry', () => {
    const errors = getFieldErrorMap({
      barcode: '',
      itemname: '',
      quantity: '',
      expdate: '',
    });

    expect(errors).toEqual({
      barcode: true,
      itemname: true,
      quantity: true,
      expdate: true,
    });
  });

  it('does not require expdate in write-off mode', () => {
    const errors = getFieldErrorMap({
      barcode: 'ABC',
      itemname: 'Milk',
      quantity: '2',
      expdate: '',
    }, { isWoMode: true });

    expect(errors).toEqual({});
  });
});
