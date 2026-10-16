'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, type FieldValues, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Kind = 'line' | 'text' | 'list';

/** How a schema field is edited: one line, a paragraph, or a list (one item per line). */
export function fieldKind(schema: z.ZodType): Kind | undefined {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) {
    s = s.unwrap() as z.ZodType;
  }
  if (s instanceof z.ZodString) return (s.maxLength ?? Infinity) > 120 ? 'text' : 'line';
  if (s instanceof z.ZodArray && s.element instanceof z.ZodString) return 'list';
  return undefined;
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * A card that shows `children` and, when `onSave` is given, edits `value` inline with a form
 * generated from `schema` (its string and string-list fields; `fields` picks which). The same
 * Zod schema validates here and in the Server Action behind `onSave`.
 */
export function EditableCard<S extends z.ZodObject>({
  title,
  schema,
  value,
  onSave,
  fields,
  labels = {},
  children,
  className,
}: {
  title: string;
  schema: S;
  value: z.input<S>;
  onSave?: (value: z.output<S>) => unknown | Promise<unknown>;
  fields?: (keyof S['shape'] & string)[];
  labels?: Partial<Record<keyof S['shape'] & string, string>>;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('editable');
  const [editing, setEditing] = useState(false);
  const keys = (fields ?? Object.keys(schema.shape)).filter((k) =>
    fieldKind(schema.shape[k] as z.ZodType),
  );
  const lists = keys.filter((k) => fieldKind(schema.shape[k] as z.ZodType) === 'list');
  // List fields are edited as text, one item per line, and split back before validation.
  const resolve = zodResolver(schema as z.ZodObject);
  const form = useForm<FieldValues>({
    values: {
      ...(value as FieldValues),
      ...Object.fromEntries(
        lists.map((k) => [
          k,
          ((value as FieldValues)[k] as string[] | undefined)?.join('\n') ?? '',
        ]),
      ),
    },
    resolver: (values, ctx, opts) =>
      resolve(
        {
          ...values,
          ...Object.fromEntries(lists.map((k) => [k, lines(String(values[k] ?? ''))])),
        },
        ctx,
        opts as never,
      ),
  });
  const save = form.handleSubmit(async (data) => {
    await onSave?.(data as z.output<S>);
    setEditing(false);
  });

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {onSave && !editing && (
          <CardAction>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('edit', { title })}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form onSubmit={save} className="flex flex-col gap-4">
            <FieldGroup>
              {keys.map((key) => {
                const multiline = fieldKind(schema.shape[key] as z.ZodType) !== 'line';
                const label = labels[key as keyof typeof labels] ?? key;
                return (
                  <Controller
                    key={key}
                    name={key}
                    control={form.control}
                    render={({ field, fieldState }) => {
                      const id = `${title}-${key}`.replace(/\W+/g, '-');
                      const common = {
                        id,
                        name: field.name,
                        onBlur: field.onBlur,
                        'aria-invalid': fieldState.invalid,
                      };
                      return (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={id}>{label}</FieldLabel>
                          {multiline ? (
                            <Textarea
                              {...common}
                              rows={4}
                              value={(field.value as string | undefined) ?? ''}
                              onChange={field.onChange}
                            />
                          ) : (
                            <Input
                              {...common}
                              value={(field.value as string | undefined) ?? ''}
                              onChange={field.onChange}
                            />
                          )}
                          {fieldState.error && <FieldError errors={[fieldState.error]} />}
                        </Field>
                      );
                    }}
                  />
                );
              })}
            </FieldGroup>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  form.reset();
                  setEditing(false);
                }}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? t('saving') : t('save')}
              </Button>
            </div>
          </form>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
