import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import UploadPage from '@/pages/UploadPage';
import AdminPage from '@/pages/AdminPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </Router>
  );
}
