import { Navigate, Route, Routes } from "react-router-dom"
import { NoAccess, useFinanceRole } from "./lib"
import Overview from "./pages/Overview"
import Invoices from "./pages/Invoices"
import InvoiceDetail from "./pages/InvoiceDetail"
import Payments from "./pages/Payments"
import PaymentDetail from "./pages/PaymentDetail"
import Mpesa from "./pages/Mpesa"
import StudentAccounts from "./pages/StudentAccounts"
import Adjustments from "./pages/Adjustments"
import Refunds from "./pages/Refunds"
import FeeSetup from "./pages/FeeSetup"
import FeeStructureEditor from "./pages/FeeStructureEditor"
import Defaulters from "./pages/Defaulters"

/** /admin/finance/* — Finance Officers manage, Auditors read. */
export default function FinanceArea() {
	const { canRead } = useFinanceRole()
	if (!canRead) return <NoAccess what="the finance office" />
	return (
		<Routes>
			<Route index element={<Overview />} />
			<Route path="invoices" element={<Invoices />} />
			<Route path="invoices/:name" element={<InvoiceDetail />} />
			<Route path="payments" element={<Payments />} />
			<Route path="payments/:name" element={<PaymentDetail />} />
			<Route path="mpesa" element={<Mpesa />} />
			<Route path="students" element={<StudentAccounts />} />
			<Route path="students/:student" element={<StudentAccounts />} />
			<Route path="adjustments" element={<Adjustments />} />
			<Route path="refunds" element={<Refunds />} />
			<Route path="setup" element={<FeeSetup />} />
			<Route path="setup/structures/new" element={<FeeStructureEditor />} />
			<Route path="setup/structures/:name" element={<FeeStructureEditor />} />
			<Route path="defaulters" element={<Defaulters />} />
			<Route path="*" element={<Navigate to="/admin/finance" replace />} />
		</Routes>
	)
}
