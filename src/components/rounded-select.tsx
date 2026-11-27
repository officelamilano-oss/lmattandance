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

function getMenuPosition(
  trigger: HTMLButtonElement,
  optionCount: number,
): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const modal = trigger.closest<HTMLElement>(
    '[role="dialog"], .advance-modal, .employee-create-modal, .employee-edit-modal',
  );
  const modalRect = modal?.getBoundingClientRect();
  const boundaryTop = Math.max(12, modalRect?.top ?? 0);
  const boundaryBottom = Math.min(
    window.innerHeight - 12,
    modalRect?.bottom ?? window.innerHeight,
  );
  const boundaryLeft = Math.max(12, modalRect?.left ?? 0);
  const boundaryRight = Math.min(
    window.innerWidth - 12,
    modalRect?.right ?? window.innerWidth,
  );
  const width = Math.min(
    Math.max(rect.width, 280),
    boundaryRight - boundaryLeft,
  );
  const left = Math.max(
    boundaryLeft,
    Math.min(rect.left, boundaryRight - width),
  );
  const desiredHeight = Math.min(320, Math.max(80, optionCount * 38 + 16));
  const belowSpace = Math.max(0, boundaryBottom - rect.bottom - 8);
  const aboveSpace = Math.max(0, rect.top - boundaryTop - 8);
  const openAbove =
    belowSpace < Math.min(desiredHeight, 160) && aboveSpace > belowSpace;
  const maxHeight = Math.max(
    1,
    Math.min(desiredHeight, openAbove ? aboveSpace : belowSpace),
  );
  const top = openAbove
    ? Math.max(boundaryTop + 8, rect.top - maxHeight - 8)
    : rect.bottom + 8;

  return {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
  };
}

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
    setPanelPosition(getMenuPosition(trigger, options.length));
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
      const trigger = triggerRef.current;
      if (trigger) setPanelPosition(getMenuPosition(trigger, options.length));
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
  }, [open, options.length]);

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
