import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { WalletContextProvider } from "./contexts/WalletContext";
import { Toaster } from "@/components/ui/toaster";
import Home from "./components/home";

function App() {
  return (
    <WalletContextProvider>
      <Suspense fallback={<p>Loading...</p>}>
        <>
          <Routes>
            <Route path="/" element={<Home />} />
          </Routes>
          <Toaster />
        </>
      </Suspense>
    </WalletContextProvider>
  );
}

export default App;