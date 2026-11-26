"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

type RoundedSelectProps = SelectHTMLAttributes<HTMLSelectElement>;
type OptionProps = {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
};
type SelectOption = {
  value: string;
  label: ReactNode;
  disabled: boolean;
};

function readOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === "option") {
      const label = child.props.children;
      options.push({
        value:
          child.props.value === undefined
            ? typeof label === "string" || typeof label === "number"
              ? String(label)
              : ""
            : String(child.props.value),
        label,
        disabled: child.props.disabled ?? false,
      });
    } else if (child.type === "optgroup") {
      options.push(...readOptions(child.props.children));
    }
  });
  return options;
}

export function RoundedSelect({
  children,
  className,
  style,
  value,
  defaultValue,
  onChange,
  disabled = false,
  required = false,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  title,
  ...selectProps
}: RoundedSelectProps) {
  const generatedId = useId();
  const baseId = id ?? `rounded-select-${generatedId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const options = readOptions(children);
  const firstOptionValue = options[0]?.value ?? "";
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue === undefined ? firstOptionValue : String(defaultValue),
  );
  const selectedValue = value === undefined ? uncontrolledValue : String(value);
  const selectedIndex = options.findIndex(
    (option) => option.value === selectedValue,
  );
  const selectedOption = options[selectedIndex] ?? options[0];
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : 0,
  );
  const [panelPosition, setPanelPosition] = useState<CSSProperties>();
  const listboxId = `${baseId}-listbox`;

  function getEnabledIndex(index: number, direction: 1 | -1) {
    if (!options.length) return -1;
    let next = ((index % options.length) + options.length) % options.length;
    while (options[next]?.disabled) {
      next = (next + direction + options.length) % options.length;
      if (next === index) return -1;
    }
    return next;
  }

  function openMenu(index = selectedIndex >= 0 ? selectedIndex : 0) {
    const trigger = triggerRef.current;
    if (!trigger || disabled) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(240, window.innerWidth - 24);
    setPanelPosition({
      position: "fixed",
      top: `${rect.bottom + 8}px`,
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
      width: `${width}px`,
    });
    const startIndex =
      index >= 0 && !options[index]?.disabled
        ? index
        : getEnabledIndex(index < 0 ? 0 : index + 1, 1);
    setActiveIndex(startIndex);
    setOpen(true);
  }

  function chooseOption(option: SelectOption) {
    if (option.disabled || !nativeRef.current) return;
    const nativeSelect = nativeRef.current;
    nativeSelect.value = option.value;
    if (value === undefined) setUncontrolledValue(option.value);
    setOpen(false);
    triggerRef.current?.focus();
    nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      )
        setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(240, window.innerWidth - 24);
      setPanelPosition({
        position: "fixed",
        top: `${rect.bottom + 8}px`,
        left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
        width: `${width}px`,
      });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        const start =
          selectedIndex >= 0
            ? selectedIndex + direction
            : direction > 0
              ? 0
              : options.length - 1;
        openMenu(getEnabledIndex(start, direction));
        return;
      }
      setActiveIndex((current) => getEnabledIndex(current + direction, direction));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) chooseOption(option);
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(getEnabledIndex(0, 1));
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(getEnabledIndex(options.length - 1, -1));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className={`dd${className ? ` ${className}` : ""}`} style={style}>
      <div className="dd-native-wrapper" aria-hidden="true">
        <select
          {...selectProps}
          ref={nativeRef}
          id={`${baseId}-native`}
          className="dd-native"
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          required={required}
          tabIndex={-1}
          onInvalid={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
            openMenu();
          }}
          onChange={onChange}
        >
          {children}
        </select>
      </div>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`dd-trigger${className ? ` ${className}` : ""}`}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-required={required || undefined}
        title={title}
        style={style}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="dd-value">{selectedOption?.label ?? "\u00a0"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            id={listboxId}
            className="dd-panel"
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            style={panelPosition}
          >
            {options.map((option, index) => (
              <div
                key={`${option.value}-${index}`}
                id={`${listboxId}-option-${index}`}
                className="dd-item"
                role="option"
                aria-selected={option.value === selectedValue}
                aria-disabled={option.disabled || undefined}
                data-active={index === activeIndex || undefined}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => chooseOption(option)}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
