import React from 'react';

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
}

const Checkbox: React.FC<CheckboxProps> = ({ checked, onCheckedChange, disabled }) => {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onCheckedChange}
      disabled={disabled}
      className="form-checkbox h-4 w-4 text-blue-600 transition duration-150 ease-in-out"
    />
  );
};

export default Checkbox;