import { MemoryRouter, Route, Routes } from "react-router";
import MainLayout from "./layouts/main-layout";
import Home from "./pages/home";
import Search from "./pages/search";
import Stat from "./pages/stat";

export default function RootRoute() {
    return (
        <MemoryRouter>
            <Routes>
                <Route element={<MainLayout />}>
                    <Route index element={<Home />} />
                    <Route path="/search" element={<Search />} />
                    <Route path="/stat/:id?" element={<Stat />} />
                </Route>
            </Routes>
        </MemoryRouter>
    );
}
