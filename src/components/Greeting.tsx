const Greeting = () => {
  const getGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    if (hour < 21) return "Good Evening";
    return "Good Evening";
  };

  return (
    <div className="greeting">
      <div className="greeting__primary">{getGreeting()}, Sir.</div>
      <div className="greeting__secondary">How can I assist you today?</div>
    </div>
  );
};

export default Greeting;
