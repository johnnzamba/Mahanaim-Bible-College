import { useEffect, useMemo, useState } from "react"
import clsx from "clsx"
import { HandHeart, Heart, Smartphone } from "lucide-react"
import { frappe } from "@/shared/api/frappe"
import { useInvalidate } from "@/shared/api/hooks"
import { MpesaPay } from "@/shared/components/MpesaPay"
import { Alert, Button, Chip, ErrorState, Input, Panel, Skeleton } from "@/shared/components/ui"
import { money } from "@/shared/utils/format"
import { DEFAULT_AMOUNTS, INVALIDATE, M } from "../lib"
import { useGivingOptions } from "../hooks"

const MAX_GIFT = 250000

/** Choose a giving type and amount, then give via M-Pesa (give_online). */
export function GivePanel({ className, id }) {
	const q = useGivingOptions()
	const invalidate = useInvalidate()
	const types = useMemo(() => q.data?.types || [], [q.data])
	const [type, setType] = useState("")
	const [amount, setAmount] = useState("")
	const [purpose, setPurpose] = useState("")
	const [error, setError] = useState("")
	const [open, setOpen] = useState(false)
	const [thanks, setThanks] = useState(null)

	useEffect(() => {
		if (!type && types.length) setType(types[0].name)
	}, [types, type])

	const current = types.find((t) => t.name === type)
	const quick = current?.suggested_amounts?.length ? current.suggested_amounts : DEFAULT_AMOUNTS
	const value = Number(amount)

	const give = () => {
		if (!type) return setError("Choose what you'd like to give towards.")
		if (!value || value < 10) return setError(`Enter an amount of at least ${money(10)}.`)
		if (value > MAX_GIFT) return setError(`For gifts above ${money(MAX_GIFT)} please use a bank transfer — contact the finance office.`)
		setError("")
		setOpen(true)
	}

	return (
		<Panel title="Give online" subtitle="Support the work of the college by M-Pesa" icon={HandHeart} className={className}>
			<div id={id} className="scroll-mt-24">
				{q.isLoading ? (
					<div className="space-y-3">
						<Skeleton className="h-16" />
						<Skeleton className="h-10" />
						<Skeleton className="h-10" />
					</div>
				) : q.isError ? (
					<ErrorState error={q.error} onRetry={() => q.refetch()} title="Giving options are unavailable" />
				) : !types.length ? (
					<p className="text-sm text-ink-muted">Online giving isn't open right now. Please contact the finance office to give.</p>
				) : (
					<div className="space-y-4">
						{thanks ? (
							<Alert tone="success" title="Thank you for your generosity!">
								Your gift of {money(thanks.amount)} towards {thanks.type} has been received. It will appear in your history shortly.
							</Alert>
						) : null}
						<fieldset>
							<legend className="label">Give towards</legend>
							<div className="grid gap-2 sm:grid-cols-2">
								{types.map((t) => {
									const on = t.name === type
									return (
										<button
											key={t.name}
											type="button"
											role="radio"
											aria-checked={on}
											onClick={() => setType(t.name)}
											className={clsx(
												"rounded-xl border p-3 text-left transition",
												on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line hover:bg-cream/60"
											)}
										>
											<div className="flex items-center gap-2 text-sm font-semibold text-ink">
												<Heart size={14} className={on ? "fill-current text-brand-700" : "text-ink-soft"} aria-hidden />
												{t.giving_type_name || t.name}
											</div>
											{t.description ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{t.description}</p> : null}
										</button>
									)
								})}
							</div>
						</fieldset>
						<div>
							<div className="label">Amount</div>
							<div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
								{quick.map((a) => (
									<Chip key={a} active={value === Number(a)} onClick={() => setAmount(String(a))}>
										{money(a)}
									</Chip>
								))}
							</div>
							<Input
								label="Or enter an amount"
								type="number"
								inputMode="numeric"
								min={10}
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								placeholder="e.g. 2000"
							/>
						</div>
						<Input label="Note (optional)" value={purpose} maxLength={140} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. In memory of…, for the library project" />
						{error ? (
							<p className="text-sm font-medium text-red-600 dark:text-red-300" role="alert">
								{error}
							</p>
						) : null}
						<Button variant="gold" icon={Smartphone} onClick={give} className="w-full justify-center">
							{value > 0 ? `Give ${money(value)} with M-Pesa` : "Give with M-Pesa"}
						</Button>
					</div>
				)}
			</div>
			<MpesaPay
				open={open}
				onClose={() => {
					setOpen(false)
					invalidate(...INVALIDATE)
				}}
				title="Give with M-Pesa"
				subtitle={current ? `${current.giving_type_name || current.name}${purpose ? ` · ${purpose}` : ""}` : undefined}
				amount={value}
				fixedAmount
				start={({ phone }) => frappe.call(M.give, { amount: value, giving_type: type, phone, purpose: purpose.trim() || undefined })}
				onDone={() => {
					invalidate(...INVALIDATE)
					setThanks({ amount: value, type: current?.giving_type_name || type })
					setAmount("")
					setPurpose("")
				}}
			/>
		</Panel>
	)
}
