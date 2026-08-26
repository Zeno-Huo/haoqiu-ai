import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import MatchNew from './pages/MatchNew'
import VideoQuality from './pages/VideoQuality'
import DetectionTask from './pages/DetectionTask'
import InstantAnalysis from './pages/InstantAnalysis'
import Analyzing from './pages/Analyzing'
import MatchReport from './pages/MatchReport'
import IdentifyPlayers from './pages/IdentifyPlayers'
import MyTeam from './pages/MyTeam'
import SingleTracking from './pages/SingleTracking'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/match/new" element={<MatchNew />} />
        <Route path="/match/:id/quality" element={<VideoQuality />} />
        <Route path="/match/:id/instant" element={<InstantAnalysis />} />
        <Route path="/match/:id/detection" element={<DetectionTask />} />
        <Route path="/match/:id/tracking" element={<SingleTracking />} />
        <Route path="/team" element={<MyTeam />} />
        <Route path="/match/:id/analyzing" element={<Analyzing />} />
        <Route path="/match/:id/identify" element={<IdentifyPlayers />} />
        <Route path="/match/:id" element={<MatchReport />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
