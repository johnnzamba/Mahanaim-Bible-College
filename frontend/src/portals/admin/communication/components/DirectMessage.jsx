import { useState } from "react"
import { X } from "lucide-react"
import { useAction } from "@/shared/api/hooks"
import { Alert, Button, Checkbox, Input, Modal, Textarea } from "@/shared/components/ui"
import { API, CHANNELS, INVALIDATE, searchRecipients } from "./common"
import { SearchPick } from "./kit"

const TYPE_LABEL = { student: "Student", staff: "Staff", sponsor: "Sponsor", email: "Email", phone: "Phone" }

/** One-off message to chosen people (send_direct_message). */
export function DirectMessage({ open, onClose }) {
	const [people, setPeople] = useState([])
	const [subject, setSubject] = useState("")
	const [message, setMessage] = useState("")
	const [channels, setChannels] = useState(["In-App", "Email"])
	const [errors, setErrors] = useState({})
	const [result, setResult] = useState(null)
	const [wasOpen, setWasOpen] = useState(false)
	if (open !== wasOpen) {
		setWasOpen(open)
		if (open) {
			setPeople([])
			setSubject("")
			setMessage("")
			setChannels(["In-App", "Email"])
			setErrors({})
			setResult(null)
		}
	}
	const send = useAction(`${API}send_direct_message`, {
		invalidate: INVALIDATE,
		success: (r) => (r.queued ? `Queued for ${r.recipients} people` : `Sent to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}`),
		onSuccess: (r) => setResult(r),
	})
	const toggle = (c) => (on) => setChannels((cs) => (on ? [...cs, c] : cs.filter((x) => x !== c)))
	const submit = () => {
		const errs = {}
		if (!people.length) errs.people = "Add at least one recipient"
		if (!subject.trim()) errs.subject = "Add a subject"
		if (!message.trim()) errs.message = "Write the message"
		if (!channels.length) errs.channels = "Choose at least one channel"
		setErrors(errs)
		if (Object.keys(errs).length) return
		send.mutate({ recipients: people.map((p) => p.spec), subject: subject.trim(), message: message.trim(), channels })
	}
	const sms = channels.includes("SMS")
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="lg"
			title="Send a message"
			subtitle="A one-off message to particular people. For whole groups, post an announcement."
			footer={
				result ? (
					<Button onClick={onClose}>Done</Button>
				) : (
					<>
						<Button variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						<Button loading={send.isPending} onClick={submit}>
							Send message
						</Button>
					</>
				)
			}
		>
			{result ? (
				<div className="space-y-3">
					<Alert tone="success" title={result.queued ? "Message queued" : "Message sent"}>
						{result.queued
							? `Delivering to ${result.recipients} people in the background.`
							: `Reached ${result.recipients} ${result.recipients === 1 ? "person" : "people"}: ${CHANNELS.map((c) => `${result.sent?.[c] || 0} ${c}`).join(", ")}${result.sent?.failed ? `, ${result.sent.failed} failed` : ""}.`}
					</Alert>
					{result.skipped?.length ? (
						<Alert tone="warning" title={`${result.skipped.length} could not be reached`}>
							They have no email, phone or account on record.
						</Alert>
					) : null}
				</div>
			) : (
				<div className="space-y-4">
					<div>
						<SearchPick
							id="dm-people"
							label="To"
							required
							value=""
							search={searchRecipients}
							error={errors.people}
							placeholder="Search students, staff, sponsors, or type an email or phone…"
							onChange={(v, r) => {
								if (v && !people.some((p) => p.value === v)) setPeople((ps) => [...ps, r])
							}}
						/>
						{people.length ? (
							<div className="mt-2 flex flex-wrap gap-1.5">
								{people.map((p) => (
									<span key={p.value} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-cream/60 py-1 pl-3 pr-1.5 text-xs">
										<span className="truncate font-medium text-ink">{p.label}</span>
										<span className="text-ink-soft">{TYPE_LABEL[p.type]}</span>
										<button type="button" aria-label={`Remove ${p.label}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-line" onClick={() => setPeople((ps) => ps.filter((x) => x.value !== p.value))}>
											<X size={12} />
										</button>
									</span>
								))}
							</div>
						) : null}
					</div>
					<Input label="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} error={errors.subject} />
					<Textarea
						label="Message"
						required
						rows={6}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						error={errors.message}
						hint={sms ? `${message.length} characters · SMS carries the first 459 (${Math.max(1, Math.ceil(Math.min(message.length, 459) / 153))} part${message.length > 160 ? "s" : ""}).` : null}
					/>
					<div>
						<span className="label">Send by</span>
						<div className="flex flex-wrap gap-5">
							{CHANNELS.map((c) => (
								<Checkbox key={c} checked={channels.includes(c)} onChange={toggle(c)} label={c === "In-App" ? "Portal notification" : c} />
							))}
						</div>
						{errors.channels ? <p className="mt-1 text-xs font-medium text-red-600">{errors.channels}</p> : null}
					</div>
				</div>
			)}
		</Modal>
	)
}

/** Send a test SMS to check the gateway. */
export function TestSms({ open, onClose }) {
	const [phone, setPhone] = useState("")
	const [text, setText] = useState("")
	const [error, setError] = useState("")
	const [result, setResult] = useState(null)
	const [wasOpen, setWasOpen] = useState(false)
	if (open !== wasOpen) {
		setWasOpen(open)
		if (open) {
			setError("")
			setResult(null)
		}
	}
	const send = useAction(`${API}send_test_sms`, { invalidate: INVALIDATE, onSuccess: setResult })
	const submit = () => {
		const n = phone.replace(/\s+/g, "")
		if (!/^(\+?254|0)?[17]\d{8}$/.test(n)) return setError("Enter a Kenyan mobile number, e.g. 0712 345 678")
		setError("")
		send.mutate({ phone: n, message: text.trim() || undefined })
	}
	const log = result?.log
	return (
		<Modal
			open={open}
			onClose={onClose}
			size="sm"
			title="Send a test SMS"
			subtitle="Checks that the SMS gateway is delivering."
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
					<Button loading={send.isPending} onClick={submit}>
						Send test
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Input label="Phone number" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} error={error} placeholder="0712 345 678" />
				<Textarea label="Message (optional)" rows={3} maxLength={459} value={text} onChange={(e) => setText(e.target.value)} placeholder="Defaults to a short test message." />
				{log ? (
					<Alert tone={log.status === "Failed" ? "error" : "success"} title={`Gateway: ${log.status}`}>
						{log.provider_response || log.name}
					</Alert>
				) : null}
			</div>
		</Modal>
	)
}
