import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import MatchNew from './pages/MatchNew'
import VideoQuality from './pages/VideoQuality'
import Analyzing from './pages/Analyzing'
import MatchReport from './pages/MatchReport'
import IdentifyPlayers from './pages/IdentifyPlayers'
import MyTeam from './pages/MyTeam'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/match/new" element={<MatchNew />} />
        <Route path="/match/:id/quality" element={<VideoQuality />} />
        <Route path="/team" element={<MyTeam />} />
        <Route path="/match/:id/analyzing" element={<Analyzing />} />
        <Route path="/match/:id/identify" element={<IdentifyPlayers />} />
        <Route path="/match/:id" element={<MatchReport />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
