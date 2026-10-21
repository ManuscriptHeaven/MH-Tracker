import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '../../lib/types';
import { activeTaskProjects, isActiveTaskProject, searchTaskProjects } from '../../lib/taskProjectOptions';

type Props = {
  projects: Project[];
  value: string | null;
  onChange: (projectId: string | null) => void;
  disabled?: boolean;
  label?: string;
};

function projectName(project: Project) {
  return `${project.project_number} · ${project.project_title}`;
}

export function ActiveProjectPicker({ projects, value, onChange, disabled = false, label = 'Project' }: Props) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const activeProjects = useMemo(() => activeTaskProjects(projects), [projects]);
  const matches = useMemo(() => searchTaskProjects(activeProjects, query), [activeProjects, query]);
  const selected = projects.find((project) => project.id === value);
  const legacyLink = !!value && (!selected || !isActiveTaskProject(selected));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  const choose = (projectId: string | null) => {
    onChange(projectId);
    setOpen(false);
    setQuery('');
    setHighlighted(0);
  };

  const openSearch = () => {
    setQuery('');
    setHighlighted(0);
    setOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) event.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openSearch();
      else setHighlighted((index) => Math.min(index + 1, matches.length - 1 < 0 ? 0 : matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openSearch();
      else setHighlighted((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault(); // Searching must not accidentally submit the task.
      if (matches[highlighted]) choose(matches[highlighted].id);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0" onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
        setOpen(false);
        setQuery('');
      }
    }}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <div className="flex min-h-11 min-w-0 items-center rounded-md border border-border bg-white focus-within:border-gold">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && matches.length ? `${listId}-option-${highlighted}` : undefined}
          disabled={disabled}
          autoComplete="off"
          placeholder="Search active projects (optional)"
          value={open ? query : selected ? projectName(selected) : value ? 'Previously linked project' : ''}
          onFocus={openSearch}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60"
        />
        {!!value && !disabled ? (
          <button type="button" aria-label="Clear selected project" title="No project" onClick={() => {
            choose(null);
            inputRef.current?.focus();
          }} className="shrink-0 rounded p-1 text-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={open ? 'Close project list' : 'Show active projects'}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (open) {
              setOpen(false);
              setQuery('');
            } else {
              inputRef.current?.focus();
              openSearch();
            }
          }}
          className="flex h-10 shrink-0 items-center px-2 text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {legacyLink && !open ? (
        <p className="mt-1 text-xs text-muted">Previously linked project is inactive or unavailable. The existing link is preserved.</p>
      ) : null}
      {open && !disabled ? (
        <div id={listId} role="listbox" aria-label="Active projects" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-white py-1 shadow-xl">
          {matches.length ? matches.map((project, index) => (
            <button
              type="button"
              role="option"
              id={`${listId}-option-${index}`}
              aria-selected={project.id === value}
              key={project.id}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => choose(project.id)}
              className={`block w-full px-3 py-2 text-left text-sm text-ink hover:bg-ivory ${highlighted === index ? 'bg-ivory' : ''}`}
            >
              <span className="block break-words font-semibold">{project.project_number} · {project.project_title}</span>
              {project.client_name ? <span className="block truncate text-xs text-muted">{project.client_name}</span> : null}
            </button>
          )) : (
            <p className="px-3 py-3 text-sm text-muted">
              {activeProjects.length ? 'No matching active projects.' : 'No active projects available.'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
