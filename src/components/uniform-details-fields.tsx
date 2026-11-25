import { UNIFORM_ITEMS, UNIFORM_ITEM_LABELS } from "@/lib/uniform-deductions";

export function UniformDetailsFields({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  return (
    <fieldset className="employee-form-section uniform-details-fields" disabled={disabled}>
      <legend>Uniform details (optional)</legend>
      <p className="muted">
        Schedule a one-time deduction. Leave the month blank to use the current month.
      </p>
      <div className="uniform-entry-grid">
        {UNIFORM_ITEMS.map((item) => (
          <div className="uniform-entry-fields" key={item}>
            <label className="uniform-item-check">
              <input type="checkbox" name={`uniform-${item}-selected`} />
              <span>{UNIFORM_ITEM_LABELS[item]}</span>
            </label>
            <label className="field">
              <span>Amount (INR)</span>
              <input
                type="number"
                name={`uniform-${item}-amount`}
                min="0"
                max="10000000"
                step="0.01"
                inputMode="decimal"
              />
            </label>
            <label className="field">
              <span>Deduction month</span>
              <input type="month" name={`uniform-${item}-month`} />
            </label>
            <label className="field">
              <span>Remark</span>
              <input name={`uniform-${item}-remark`} maxLength={500} />
            </label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
